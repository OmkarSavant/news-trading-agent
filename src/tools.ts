import { tool } from "ai";
import { z } from "zod";
import {
  applyBuy,
  applySell,
  readLedger,
  writeLedger,
  type Ledger,
} from "./ledger.js";

const GOOGLE_NEWS_BUSINESS_RSS =
  "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en";

const STOOQ_QUOTE_URL = "https://stooq.com/q/l/";

const UA = "Mozilla/5.0 (compatible; news-trade-agent/0.1)";

// Stooq uses ".us" suffix and lowercase; Berkshire is "brk-b.us"
function toStooqSymbol(ticker: string): string {
  return ticker.toLowerCase() + ".us";
}

export type NewsStory = {
  title: string;
  link: string;
  pubDate: string;
  source: string;
};

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function pickTag(item: string, tag: string): string {
  const m = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decodeEntities(m[1]).trim() : "";
}

export async function fetchTopNews(n: number): Promise<NewsStory[]> {
  const res = await fetch(GOOGLE_NEWS_BUSINESS_RSS, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) {
    throw new Error(`Google News RSS fetch failed: ${res.status}`);
  }
  const xml = await res.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items.slice(0, n).map((item) => ({
    title: pickTag(item, "title"),
    link: pickTag(item, "link"),
    pubDate: pickTag(item, "pubDate"),
    source: pickTag(item, "source"),
  }));
}

async function fetchOnePriceFromStooq(ticker: string): Promise<number | null> {
  const url = `${STOOQ_QUOTE_URL}?s=${toStooqSymbol(ticker)}&f=sd2t2ohlcv&h&e=csv`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  const csv = await res.text();
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return null;
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const closeIdx = header.indexOf("close");
  if (closeIdx < 0) return null;
  const parts = lines[1].split(",");
  const close = Number(parts[closeIdx]?.trim());
  return Number.isFinite(close) ? close : null;
}

export async function fetchPrices(
  tickers: string[],
): Promise<Record<string, number>> {
  if (tickers.length === 0) return {};
  const results = await Promise.all(
    tickers.map(async (t) => [t, await fetchOnePriceFromStooq(t)] as const),
  );
  const out: Record<string, number> = {};
  for (const [t, p] of results) {
    if (p !== null) out[t.toUpperCase()] = p;
  }
  return out;
}

export async function fetchPrice(ticker: string): Promise<number> {
  const price = await fetchOnePriceFromStooq(ticker);
  if (price === null) {
    throw new Error(`No price returned for ${ticker}`);
  }
  return price;
}

/* ---- Vercel AI SDK tool definitions ---- */

export const getTopNewsTool = tool({
  description:
    "Fetch the top N business news stories from Google News. Returns title, link, publication date, and source. Use this to understand current market-moving events.",
  inputSchema: z.object({
    n: z.number().int().min(1).max(10).default(5),
  }),
  execute: async ({ n }) => {
    const stories = await fetchTopNews(n);
    return { stories };
  },
});

export const getStockPriceTool = tool({
  description:
    "Get the current market price for a US-listed stock (NYSE or NASDAQ). Returns the regular-market price in USD.",
  inputSchema: z.object({
    ticker: z.string().describe("Ticker symbol, e.g. AAPL, BRK-B, WMT"),
  }),
  execute: async ({ ticker }) => {
    const price = await fetchPrice(ticker);
    return { ticker, price };
  },
});

export const readLedgerTool = tool({
  description:
    "Read the current trade ledger. Returns current holdings (shares and avg cost), realized P&L, last P&L snapshot, and trade history.",
  inputSchema: z.object({}),
  execute: async () => {
    const ledger = await readLedger();
    return ledger;
  },
});

export const recordTradeTool = tool({
  description:
    "Record a trade of exactly 1 share. Must be a NYSE- or NASDAQ-listed stock. Sells are only permitted if the ledger holds >= 1 share of that ticker. The current market price will be fetched automatically. Include a brief reason citing the news story that motivated the trade.",
  inputSchema: z.object({
    action: z.enum(["buy", "sell"]),
    ticker: z.string().describe("Ticker symbol, e.g. NVDA, WMT, BRK-B"),
    reason: z
      .string()
      .describe("1-2 sentence rationale referencing specific news"),
  }),
  execute: async ({ action, ticker, reason }) => {
    const ledger: Ledger = await readLedger();
    if (action === "sell") {
      const held = ledger.holdings[ticker]?.shares ?? 0;
      if (held < 1) {
        return {
          ok: false as const,
          error: `Cannot sell ${ticker}: current holding is ${held} shares.`,
        };
      }
    }
    const price = await fetchPrice(ticker);
    if (action === "buy") applyBuy(ledger, ticker, price);
    else applySell(ledger, ticker, price);

    ledger.trades.push({
      ts: new Date().toISOString(),
      action,
      ticker,
      price,
      reason,
    });
    await writeLedger(ledger);
    return { ok: true as const, action, ticker, price, reason };
  },
});

export const tools = {
  get_top_news: getTopNewsTool,
  get_stock_price: getStockPriceTool,
  read_ledger: readLedgerTool,
  record_trade: recordTradeTool,
};
