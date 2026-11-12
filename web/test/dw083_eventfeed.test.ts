import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEvents } from "../src/components/eventFeed.js";

// DW-083: the new private lines read as dispatches, in the second person for the firm they name.
test("DW-083: credit, repayment, guard, overdraft and purchase lines parse with no raw prefix", () => {
  const you = "Copper & Cask";
  const ev = parseEvents([
    `CREDIT REFUSED: the bank lends ${you} nothing of the $1,055,000 it asked — losses have used up its equity, and the bank lends against equity`,
    `CREDIT: the bank lends ${you} only $1,058,148 of the $1,740,000 it asked — debt may not exceed 3× equity`,
    `REPAYMENT CUT: ${you} repays nothing of the $20,000 it planned — its cash would fall below the $60,000 covenant floor; the debt stays owed`,
    `REPAYMENT CUT: ${you} repays $12,000 of the $20,000 it planned — a repayment may not take cash below the $60,000 covenant floor; the rest stays owed`,
    `BLOCKED: ${you} cannot pay for its whole plan — $961,000 of spending against $231,637 of cash and financing; the bank lends $0 of the $1,055,000 asked. Cut: tank order $830,000 → $100,637`,
    `OVERDRAFT: the bank covers ${you}'s $9,839 shortfall with an emergency overdraft — it is debt now, priced at the penalty rate`,
    `OVERDRAFT EXHAUSTED: ${you} is $194,248 short and the bank's emergency line stops at $157,184 (25% of its assets)`,
    `PURCHASE FAILED: ${you} cannot fund the hop & grain supplier ($112,000; it began the round with $50,000)`,
  ], you);
  assert.deepEqual(ev.map((e) => e.title), ["Loan refused", "Loan cut", "Repayment held back", "Repayment held back", "Orders cut", "Emergency overdraft", "Overdraft ran out", "Purchase fell through"]);
  for (const e of ev) {
    assert.ok(e.mine, `${e.title} is the player's own`);
    assert.doesNotMatch(String(e.body), /^(CREDIT|REPAYMENT|BLOCKED|OVERDRAFT|PURCHASE)/, "no raw prefix leaks");
  }
  assert.match(String(ev[0].body), /^The bank lent you nothing of the \$1,055,000 asked for\. The bank's reason: losses have used up your equity/);
  assert.match(String(ev[1].body), /^The bank lent you only \$1,058,148 of the \$1,740,000 asked for/);
  assert.match(String(ev[5].body), /^The bank covered your \$9,839 shortfall/);
  assert.match(String(ev[2].body), /^You repaid none of the \$20,000 planned/);
  assert.match(String(ev[4].body), /^You couldn't pay for the whole plan\. It called for \$961,000 of spending, but cash and financing came to \$231,637 \(the bank lends \$0 of the \$1,055,000 asked\)\. Cut to fit: tank order \$830,000 → \$100,637\.$/);
  assert.match(String(ev[6].body), /^You were \$194,248 short/);
  assert.match(String(ev[7].body), /^You couldn't fund the hop & grain supplier \(\$112,000\)/);
});
