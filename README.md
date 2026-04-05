# news-trade-agent

A tiny paper-trading agent that runs every 30 minutes, reads the top 5 Google News
Business headlines, and recommends **exactly one** buy or sell of **one share**.
State lives in `ledger.json`, committed back to this repo by the cron workflow.

Built to compare how the same agent run looks across three observability tools:
**Raindrop**, **Braintrust**, and **Laminar**.

## Stack

- TypeScript, Node 20
- [Vercel AI SDK](https://ai-sdk.dev) + Gemini 3 Flash (cheap)
- GitHub Actions cron (`*/30 * * * *`)
- Google News RSS (no API key) for headlines
- Yahoo Finance `query1` endpoint (no API key) for quotes

## Setup

```bash
npm install
cp .env.example .env   # fill in GOOGLE_GENERATIVE_AI_API_KEY + any tracer keys
npm run seed           # creates ledger.json with 1 share each of Fortune 10
npm run run            # one manual run
```

Then add GitHub repo secrets: `GOOGLE_GENERATIVE_AI_API_KEY`, `RAINDROP_WRITE_KEY`,
`BRAINTRUST_API_KEY`, `LAMINAR_PROJECT_API_KEY`. Tracer keys are optional;
the agent skips any tracer whose key is absent.

## Files

- `src/agent.ts` — entrypoint: P&L snapshot → generateText with tools
- `src/tools.ts` — 4 tool defs + raw fetch helpers
- `src/ledger.ts` — JSON ledger read/write/buy/sell/P&L
- `src/observability.ts` — init Raindrop + Braintrust + Laminar
- `scripts/seed.ts` — Fortune 10 seed at live prices
- `.github/workflows/trade-agent.yml` — cron + commit

## Ledger format

```json
{
  "holdings": { "NVDA": { "shares": 2, "avg_cost": 850.25 } },
  "trades": [
    { "ts": "...", "action": "buy", "ticker": "NVDA", "price": 860.50, "reason": "..." }
  ],
  "realized_pnl": 0,
  "last_pnl_snapshot": { "ts": "...", "unrealized": 20.50, "total": 20.50, "prices": { "NVDA": 860.50 } }
}
```
