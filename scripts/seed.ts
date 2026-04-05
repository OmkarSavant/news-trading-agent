/**
 * Seed ledger.json with 1 share of each of the (current) Fortune 10.
 * Uses live Yahoo prices as the cost basis.
 *
 * Fortune 10 (2024 ranking): WMT, AMZN, AAPL, UNH, BRK-B, CVS, XOM, GOOGL, MCK, COR
 */

import { fetchPrices } from "../src/tools.js";
import { writeLedger, type Ledger } from "../src/ledger.js";

const SEED_TICKERS = [
  "WMT",
  "AMZN",
  "AAPL",
  "UNH",
  "BRK-B",
  "CVS",
  "XOM",
  "GOOGL",
  "MCK",
  "COR",
];

async function main() {
  console.log("[seed] fetching prices for:", SEED_TICKERS.join(", "));
  const prices = await fetchPrices(SEED_TICKERS);

  const missing = SEED_TICKERS.filter((t) => !(t in prices));
  if (missing.length > 0) {
    throw new Error(`missing prices for: ${missing.join(", ")}`);
  }

  const ts = new Date().toISOString();
  const ledger: Ledger = {
    holdings: {},
    trades: [],
    realized_pnl: 0,
    last_pnl_snapshot: null,
  };

  for (const ticker of SEED_TICKERS) {
    const price = prices[ticker];
    ledger.holdings[ticker] = { shares: 1, avg_cost: price };
    ledger.trades.push({
      ts,
      action: "buy",
      ticker,
      price,
      reason: "Seed position (Fortune 10)",
    });
  }

  await writeLedger(ledger);
  console.log("[seed] wrote ledger.json with", SEED_TICKERS.length, "holdings");
  for (const t of SEED_TICKERS) {
    console.log(`  ${t.padEnd(6)} @ $${prices[t].toFixed(2)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
