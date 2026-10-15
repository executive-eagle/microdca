# MicroDCA

Free, open-source bitcoin DCA and bitcoin-income simulator.

**Live site:** https://executive-eagle.github.io/microdca/

- **Bitcoin DCA**: backtest buying bitcoin daily, weekly or monthly vs. a lump sum.
- **Income**: DCA into STRC, STRF, STRK, STRD, BTCI (or any fund you add), then split every payout between reinvesting, buying BTC/IBIT, paying down margin, bills and savings, with opportunity cost and per-timeframe results.
- **Live $10K**: a hypothetical $10,000 portfolio started Oct 15, 2026 that reinvests dividends every day.

## Add or change a fund

Everything lives in [`assets.json`](assets.json). Edit it on GitHub and commit:

- **Income fund**: copy a block in `income`, set `ticker`, `yahoo` symbol, `name`, `color`, `annual_dividend` (dollars per share per year, or `"ttm"`), and `schedule` (`semimonthly`, `monthly`, `quarterly`, `daily`).
- **Non-income asset** you can route payouts into (like IBIT): add it to `growth`.
- **Presets**: `income_presets` (how purchases are split) and `payout_presets` (how payouts are split).
- **$10K portfolio**: `portfolio.allocation` and `portfolio.start_prices`.

Prices and dividend history for every listed ticker are downloaded automatically.

## How data updates

A GitHub Action (`.github/workflows/deploy.yml`) runs twice a day: it pulls daily closes and dividend history from Yahoo Finance's public chart endpoint (no API key), commits `public/data/prices.json`, rebuilds and redeploys to GitHub Pages. If a fetch fails, the previous data is kept. The bitcoin price also updates live in the browser from CoinGecko's free API.

## Run locally

```bash
npm install
npm run fetch-prices
npm run dev
```

## Disclaimer

Educational simulation, not financial advice. Past performance does not predict future results. Strategy's preferred stock is not collateralized by its bitcoin holdings and dividends are not guaranteed. Covered-call ETFs like BTCI cap upside and can lose NAV over time. The $10K portfolio is hypothetical; no real money is invested.
