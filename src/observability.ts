/**
 * Wires up three independent observability backends on the same agent run:
 *   1. Raindrop   — via raindrop-ai SDK (manual interaction + spans)
 *   2. Braintrust — via wrapAISDK() to auto-trace Vercel AI SDK calls
 *   3. Laminar    — via @lmnr-ai/lmnr, OTel-based, consumes AI SDK telemetry
 *
 * Each backend is enabled only if its env var is present.
 */

import * as ai from "ai";

export type WrappedAI = typeof ai;

export type RaindropInteraction = {
  withSpan: <T>(
    opts: { name: string },
    fn: () => Promise<T>,
  ) => Promise<T>;
  finish: (opts: { output: string }) => Promise<void> | void;
};

export type Observability = {
  ai: WrappedAI;
  raindropInteraction: RaindropInteraction | null;
  flush: () => Promise<void>;
};

export async function initObservability(): Promise<Observability> {
  let wrappedAI: WrappedAI = ai;
  let raindropInteraction: RaindropInteraction | null = null;
  const flushers: Array<() => Promise<void>> = [];

  // --- Laminar (OTel) ---
  if (process.env.LAMINAR_PROJECT_API_KEY) {
    const { Laminar } = await import("@lmnr-ai/lmnr");
    Laminar.initialize({ projectApiKey: process.env.LAMINAR_PROJECT_API_KEY });
    flushers.push(async () => {
      await Laminar.shutdown();
    });
    console.log("[obs] Laminar initialized");
  }

  // --- Braintrust (wraps AI SDK) ---
  if (process.env.BRAINTRUST_API_KEY) {
    const { initLogger, wrapAISDK } = await import("braintrust");
    initLogger({
      projectName: "news-trade-agent",
      apiKey: process.env.BRAINTRUST_API_KEY,
    });
    wrappedAI = wrapAISDK(ai) as unknown as WrappedAI;
    console.log("[obs] Braintrust initialized");
  }

  // --- Raindrop ---
  if (process.env.RAINDROP_WRITE_KEY) {
    const raindropMod: any = await import("raindrop-ai");
    const Ctor = raindropMod.Raindrop ?? raindropMod.default;
    const raindrop = new Ctor({
      writeKey: process.env.RAINDROP_WRITE_KEY,
    });
    raindropInteraction = raindrop.begin({
      eventId: `run-${Date.now()}`,
      event: "trade_run",
      userId: "news-trade-agent",
      input: "scheduled trading run",
    });
    flushers.push(async () => {
      if (typeof raindrop.close === "function") await raindrop.close();
      else if (typeof raindrop.shutdown === "function") await raindrop.shutdown();
    });
    console.log("[obs] Raindrop initialized");
  }

  return {
    ai: wrappedAI,
    raindropInteraction,
    flush: async () => {
      for (const f of flushers) {
        try {
          await f();
        } catch (e) {
          console.error("[obs] flush error:", e);
        }
      }
    },
  };
}
