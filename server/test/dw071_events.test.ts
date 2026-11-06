/**
 * DW-071: a firm's private news (a refused/trimmed equity raise, a hire it couldn't pay for)
 * reaches only that firm's view; everything else stays public.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleEvents } from "../src/names.js";

const EVENTS = [
  "HIRE: firm_1 brings on a head brewer",
  "EQUITY MARKET CLOSED: no investor will fund firm_1's $500,000 raise — its losses have pushed its valuation to zero or below",
  "EQUITY: investors fund only $139,000 of the $1,200,000 firm_2 sought — 50% of its valuation is the most they will buy in a quarter",
  "HIRE FAILED: firm_10 cannot cover a head brewer's $21,600 signing bonus + first salary",
  "FORCED EXIT (bankruptcy): firm_3 (cash $-143,247, coverage -27.13)",
];

test("private news reaches only the firm it names", () => {
  assert.deepEqual(visibleEvents(EVENTS, "firm_1"), [EVENTS[0], EVENTS[1], EVENTS[4]]);
  assert.deepEqual(visibleEvents(EVENTS, "firm_2"), [EVENTS[0], EVENTS[2], EVENTS[4]]);
  assert.deepEqual(visibleEvents(EVENTS, "firm_10"), [EVENTS[0], EVENTS[3], EVENTS[4]], "firm_1 must not match firm_10");
  assert.deepEqual(visibleEvents(EVENTS, null), [EVENTS[0], EVENTS[4]], "a viewer without a firm sees only public news");
});

test("DW-083: the bank's answer, a cut repayment, guard cuts, an overdraft and a failed purchase are private too", () => {
  const E = [
    "CREDIT: the bank lends firm_2 only $1,058,148 of the $1,740,000 it asked — debt may not exceed 3× equity",
    "CREDIT REFUSED: the bank lends firm_5 nothing of the $1,055,000 it asked — losses have used up its equity, and the bank lends against equity",
    "REPAYMENT CUT: firm_7 repays nothing of the $20,000 it planned — its cash would fall below the $60,000 covenant floor; the debt stays owed",
    "BLOCKED: firm_4 cannot pay for its whole plan — $2,294,418 of spending against $292,001 of cash and financing. Cut: tank order ($2,000,000) dropped",
    "OVERDRAFT: the bank covers firm_1's $9,839 shortfall with an emergency overdraft — it is debt now, priced at the penalty rate",
    "OVERDRAFT EXHAUSTED: firm_1 is $194,248 short and the bank's emergency line stops at $157,184 (25% of its assets)",
    "PURCHASE FAILED: firm_3 cannot fund the hop & grain supplier ($112,000; it began the round with $50,000)",
    "EXPANSION: firm_3 enters Heartland",
  ];
  assert.deepEqual(visibleEvents(E, "firm_1"), [E[4], E[5], E[7]]);
  assert.deepEqual(visibleEvents(E, "firm_5"), [E[1], E[7]]);
  assert.deepEqual(visibleEvents(E, null), [E[7]]);
});
