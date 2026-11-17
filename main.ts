// Dip-and-ride v2: a long-only CBBTC bot for agent-fun/bars-replay/v1.
//
// Variant of the submitted "dip-and-ride" entry (dev net PnL +$22.35), with
// two exit changes, both validated on the dev window plus 24 rotations of
// it, the time-reversed window and a 120-sample block bootstrap:
//
//   1. Take-profit: sell as soon as the close is 160 bps above the entry
//      close. A rally that runs +160 bps is banked on the way up instead of
//      waiting for the trailing stop to fire on the way down after the peak.
//      On the dev window both round trips exit through this rule.
//   2. The trailing stop tightens later and harder: 30 bps once the
//      position is up 150 bps (was 40 bps once up 100 bps). It is only a
//      backstop behind the take-profit; on the dev window it never fires
//      before the take-profit does.
//
// Everything else is unchanged from the submitted entry: buy the dip
// (60 bps below the window's opening close, full size), re-enter only after
// the price has recovered above the open plus a 30-bar cooldown, skip a dip
// inside a steep 240-bar fall, a late fallback entry so a rising-only
// window still produces a trade, and no entries after bar 1320.
//
// The dev window is a flat, choppy market (1-minute noise ~6 bps, a
// full-size round trip costs ~26 bps), so frequent trading bleeds fees and
// every short-horizon trend / mean-reversion / breakout rule tested lost
// money. What works is rare, patient, full-size swing trades.
//
// All decisions are exact integer (bigint) comparisons on closes, so two
// runs produce byte-identical action logs. No randomness, no clock, no
// files, no environment: the only inputs are the bars on stdin.

import { runBars, type BarsState, type BuyInput, type OrderInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const BPS = 10000n;
/** Buy when the close is this far below the window's opening close. */
const DIP_BPS = 60n;
/** Trailing stop: exit this far below the highest close since entry. */
const STOP_BPS = 80n;
/** Once the position is up this far from entry, tighten the trail. */
const TIGHT_AT_BPS = 150n;
/** The tightened trailing stop. */
const TIGHT_BPS = 30n;
/** Take-profit: sell as soon as the close is this far above the entry close. */
const TAKE_PROFIT_BPS = 160n;
/** Bars to wait after an exit before a new entry. */
const COOLDOWN_BARS = 30;
/** Downtrend filter: skip a dip-buy when the return over this many bars is below FILTER_BPS. */
const FILTER_BARS = 240;
const FILTER_BPS = -120n;
/** Fallback entry (only when nothing has traded yet): bars in, price above the open by this, 240-bar return above this. */
const FALLBACK_BAR = 960;
const FALLBACK_ABOVE_BPS = 50n;
const FALLBACK_TREND_BPS = 30n;
/** No new entries after this scored bar. */
const NO_ENTRY_AFTER = 1320;
/** Max slippage vs the latest close, generous against observed 1-minute moves (max ~45 bps). */
const MAX_SLIPPAGE_BPS = 500;

/** Closes by scored bar (null when the symbol had no bar that minute). */
const closes: (bigint | null)[] = [];
/** The window's opening close: the first close of the scored window. */
let open0: bigint | null = null;
/** Highest close since the current entry; the entry close itself. */
let peak: bigint | null = null;
let entryPx: bigint | null = null;
/** Whether a new dip-buy is allowed (false after an exit until the price recovers above the open). */
let armed = true;
/** Scored bar of the last exit; buys sent so far. */
let lastExit = -1000000;
let buysSent = 0;

function latestClose(): bigint | null {
  for (let i = closes.length - 1; i >= 0; i--) {
    if (closes[i] !== null) return closes[i];
  }
  return null;
}

function closeAtBack(n: number): bigint | null {
  const i = closes.length - 1 - n;
  return i >= 0 ? closes[i] : null;
}

await runBars({
  onBatch(state: BarsState, batch) {
    const n = batch.seq - state.warmupBars; // scored-bar index (0-based)
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    closes.push(bar === undefined ? null : BigInt(bar.c));
    if (open0 === null && bar !== undefined) open0 = BigInt(bar.c);
    if (state.warmingUp || open0 === null) return [];

    const close = latestClose();
    if (close === null) return [];
    const held = state.positions.get(SYMBOL);

    if (held === undefined) {
      if (n >= NO_ENTRY_AFTER) return [];
      if (!armed) {
        if (close > open0) armed = true;
        else return [];
      }
      if (n - lastExit < COOLDOWN_BARS) return [];
      // Steep multi-hour fall: a dip inside a downtrend, not a buying opportunity.
      const old = closeAtBack(FILTER_BARS);
      if (old !== null && (close - old) * BPS < FILTER_BPS * old) return [];
      if (close * BPS < open0 * (BPS - DIP_BPS)) {
        peak = close;
        entryPx = close;
        buysSent++;
        return buyAll(state);
      }
      if (buysSent === 0 && n >= FALLBACK_BAR && close * BPS > open0 * (BPS + FALLBACK_ABOVE_BPS)) {
        if (old !== null && (close - old) * BPS > FALLBACK_TREND_BPS * old) {
          peak = close;
          entryPx = close;
          buysSent++;
          return buyAll(state);
        }
      }
      return [];
    }

    // Holding: bank a strong rally on the way up; otherwise trail the peak,
    // tightening once comfortably in profit.
    if (entryPx !== null && close * BPS >= entryPx * (BPS + TAKE_PROFIT_BPS)) {
      armed = false;
      lastExit = n;
      return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies SellInput];
    }
    if (peak === null || close > peak) peak = close;
    let stop = STOP_BPS;
    if (entryPx !== null && close * BPS > entryPx * (BPS + TIGHT_AT_BPS)) stop = TIGHT_BPS;
    if (close * BPS < peak * (BPS - stop)) {
      armed = false;
      lastExit = n;
      return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies SellInput];
    }
    return [];
  },
});

/** Spend all cash on CBBTC (no order when the cash cannot clear the minimum notional). */
function buyAll(state: BarsState): OrderInput[] {
  if (state.cash < BigInt(state.hello.fees.min_notional_quote_units)) return [];
  return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies BuyInput];
}
