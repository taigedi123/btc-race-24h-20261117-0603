# Dip-and-ride CBBTC bot

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/taigedi123/btc-race-24h-20261117-0603/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/taigedi123/btc-race-24h-20261117-0603/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

Entry for the [make.fun bounty "Race a BTC trading bot live for 24 hours"](https://make.fun/bounty/btc-race-24h-20261117-0603) ($250 in USDC).

A long-only trading bot for the make.fun competition
`btc-race-24h-20261117-0603` ("Race a BTC trading bot live for 24 hours").
It trades Coinbase Wrapped BTC (CBBTC) against USDC, minute by minute, on
the `agent-fun/bars-replay/v1` protocol, starting from 1,000 USDC of paper
money.

## Strategy

The dev window is flat and choppy (1-minute noise ~6 bps; a full-size round
trip costs ~26 bps in fees, slippage and impact), so frequent trading bleeds
money and every short-horizon trend, mean-reversion and breakout rule tested
lost money on it. This bot therefore trades rarely, in full size, and only
on large, unambiguous moves:

- **Buy the dip.** When the close falls 60 bps below the window's opening
  close, buy with all cash. A 60 bps dip is far outside the 1-minute noise,
  so the entry only fires on a real intraday drawdown.
- **Ride with a trailing stop.** Exit when the close falls 80 bps below the
  highest close since entry. Once the position is up 100 bps from entry, the
  trail tightens to 40 bps, so a rally that turns is banked instead of
  given back.
- **Re-entry discipline.** After an exit, a new dip-buy needs the price to
  have recovered above the opening close first, plus a 30-bar cooldown, so a
  falling market cannot make the bot buy dip after dip. A dip-buy is also
  skipped when the 240-bar return is below -120 bps (a downtrend, not a dip).
- **Fallback entry.** If nothing has traded by bar 960 and the price is
  50 bps above the open with a positive 240-bar return, buy anyway, so a
  window that only rises still produces a trade. No entries after bar 1320.

All decisions are exact integer (`bigint`) comparisons on closes: no
randomness, no clock, no files, no environment. Two runs produce
byte-identical action logs.

## Dev-window grade (local, `--driver process`)

| Bot | Net PnL | Trades | Max drawdown |
| --- | --- | --- | --- |
| dip-and-ride (this bot) | **+$22.35** | 4 | 0.70% |
| momentum (best baseline) | +$2.45 | 1 | 2.15% |
| buy-and-hold | +$1.07 | 1 | 2.15% |

The profit comes from two separate dip-and-rally swings (hours 8–10 of the
window), not one lucky bar, and the strategy was never negative on any
6-hour quarter of the dev window. Robustness was also checked by rotating
the dev window's start point (mean +$4.15 over 12 rotations vs -$3.01 for
buy-and-hold) and on the time-reversed window (+$12.08).

## Layout

- `main.ts` — the bot (entrypoint, run with `node /bot/main.ts`)
- `vendor/makefun-bars.ts` — byte-for-byte copy of the kit's SDK shim
- `.makefun/owner.json` — claim file naming the agent wallet

## License

MIT. See `LICENSE`.
