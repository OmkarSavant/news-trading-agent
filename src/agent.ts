import { google } from "@ai-sdk/google";
import { stepCountIs } from "ai";
import { initObservability } from "./observability.js";
import { tools } from "./tools.js";
import { fetchPrices } from "./tools.js";
import { computePnl, readLedger, writeLedger } from "./ledger.js";

// Cheap + fast; swap to a larger Gemini model if you want better reasoning.
const MODEL = "gemini-3-flash-preview";

const SYSTEM_PROMPT = `You are a news-driven trade recommendation agent.

On each invocation you must:
  1. Call read_ledger to see current holdings, cost basis, and realized P&L.
  2. Call get_top_news to read the top 5 business headlines.
  3. Based strictly on those headlines, pick exactly ONE trade of exactly ONE share.
     - action is "buy" or "sell"
     - ticker must be a US-listed NYSE or NASDAQ stock
     - you may only "sell" a ticker you currently hold (shares >= 1)
  4. Call record_trade with action, ticker, and a 1-2 sentence reason that
     cites the specific headline that motivated it.
  5. After record_trade returns, respond with a single-paragraph summary of
     the trade and your reasoning. Do not call any more tools.

Rules:
  - Issue exactly one record_trade call per run. Never zero, never more than one.
  - Do not fabricate headlines. Only cite stories returned by get_top_news.
  - Do not recommend OTC, foreign, or crypto tickers.
  - If no headline supports a clear trade, pick a buy on the most relevant
    large-cap name mentioned or implied by the news.`;

async function updatePnlSnapshot() {
  const ledger = await readLedger();
  const tickers = Object.keys(ledger.holdings);
  const prices = await fetchPrices(tickers);
  ledger.last_pnl_snapshot = computePnl(ledger, prices);
  await writeLedger(ledger);
  return ledger.last_pnl_snapshot;
}

async function main() {
  const obs = await initObservability();

  console.log("[agent] updating P&L snapshot...");
  const snap = await updatePnlSnapshot();
  console.log(
    `[agent] unrealized=${snap.unrealized.toFixed(2)} total=${snap.total.toFixed(2)}`,
  );

  console.log("[agent] running trade agent...");
  const runAgent = async () =>
    obs.ai.generateText({
      model: google(MODEL),
      system: SYSTEM_PROMPT,
      prompt: "It is time for your scheduled trading run. Begin.",
      tools,
      // Safety net only; agent should finish well before this.
      stopWhen: stepCountIs(30),
      onStepFinish: (step) => {
        const calls =
          step.toolCalls.map((c) => c.toolName).join(", ") || "(none)";
        console.log(
          `[agent]   step: tools=[${calls}] text=${step.text.slice(0, 80) || "(empty)"}`,
        );
      },
      experimental_telemetry: {
        isEnabled: true,
        functionId: "news_trade_agent",
        metadata: { run_ts: new Date().toISOString() },
      },
    });

  const result = obs.raindropInteraction
    ? await obs.raindropInteraction.withSpan(
        { name: "news_trade_agent" },
        runAgent,
      )
    : await runAgent();

  console.log("\n[agent] final response:\n" + result.text);
  console.log(
    `\n[agent] steps=${result.steps.length} tool_calls=${result.steps.flatMap((s) => s.toolCalls).length}`,
  );

  if (obs.raindropInteraction) {
    await obs.raindropInteraction.finish({ output: result.text });
  }

  await obs.flush();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
