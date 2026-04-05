import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const LEDGER_PATH = path.resolve(process.cwd(), "ledger.json");

export type Holding = { shares: number; avg_cost: number };

export type Trade = {
  ts: string;
  action: "buy" | "sell";
  ticker: string;
  price: number;
  reason: string;
};

export type PnlSnapshot = {
  ts: string;
  unrealized: number;
  total: number;
  prices: Record<string, number>;
};

export type Ledger = {
  holdings: Record<string, Holding>;
  trades: Trade[];
  realized_pnl: number;
  last_pnl_snapshot: PnlSnapshot | null;
};

export async function readLedger(): Promise<Ledger> {
  if (!existsSync(LEDGER_PATH)) {
    throw new Error(
      `ledger.json not found at ${LEDGER_PATH}. Run \`npm run seed\` first.`,
    );
  }
  const raw = await readFile(LEDGER_PATH, "utf8");
  return JSON.parse(raw) as Ledger;
}

export async function writeLedger(ledger: Ledger): Promise<void> {
  await writeFile(LEDGER_PATH, JSON.stringify(ledger, null, 2) + "\n", "utf8");
}

export function applyBuy(
  ledger: Ledger,
  ticker: string,
  price: number,
): void {
  const existing = ledger.holdings[ticker];
  if (existing) {
    const newShares = existing.shares + 1;
    const newAvgCost =
      (existing.avg_cost * existing.shares + price) / newShares;
    ledger.holdings[ticker] = { shares: newShares, avg_cost: newAvgCost };
  } else {
    ledger.holdings[ticker] = { shares: 1, avg_cost: price };
  }
}

export function applySell(
  ledger: Ledger,
  ticker: string,
  price: number,
): void {
  const existing = ledger.holdings[ticker];
  if (!existing || existing.shares < 1) {
    throw new Error(
      `Cannot sell ${ticker}: holding is ${existing?.shares ?? 0} shares.`,
    );
  }
  const realized = price - existing.avg_cost;
  ledger.realized_pnl += realized;
  const newShares = existing.shares - 1;
  if (newShares === 0) {
    delete ledger.holdings[ticker];
  } else {
    ledger.holdings[ticker] = { shares: newShares, avg_cost: existing.avg_cost };
  }
}

export function computePnl(
  ledger: Ledger,
  prices: Record<string, number>,
): PnlSnapshot {
  let unrealized = 0;
  for (const [ticker, holding] of Object.entries(ledger.holdings)) {
    const price = prices[ticker];
    if (price === undefined) continue;
    unrealized += (price - holding.avg_cost) * holding.shares;
  }
  return {
    ts: new Date().toISOString(),
    unrealized,
    total: unrealized + ledger.realized_pnl,
    prices,
  };
}
