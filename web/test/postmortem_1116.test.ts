import { test } from "node:test";
import assert from "node:assert/strict";
import type { FirmDecision } from "drinkwars-engine";
import { SinglePlayerGame } from "../src/game/controller.js";
import { moneyOutcome, runningCostsAsGuard } from "../src/lib/moneyCheck.js";
import { planCash } from "../src/lib/planSummary.js";
import { financingGrant, equityCapacity } from "drinkwars-engine";

// 11-16 · fixes from the F26 post-mortems (vault 20_Postmortem_Synthesis § Dev handoff, items 1–3).

const started = async (override?: Parameters<SinglePlayerGame["start"]>[0]) => {
  const g = new SinglePlayerGame();
  await g.start(override ?? {});
  const v0 = await g.view();
  const segs = v0.segments.filter((s) => s.active).map((s) => s.id);
  const d = (x: Partial<FirmDecision> = {}): FirmDecision => ({
    firm_id: "firm_1", price: Object.fromEntries(segs.map((s) => [s, 7.65])), presence: Object.fromEntries(segs.map((s) => [s, 1])),
    invest_cap: 0, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0, invest_T_gov: 0,
    debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, agreement_actions: [], exit_action: null, ...x,
  });
  return { g, v0, d };
};

test("item 2 · the rail's interest line is the guard's: rate × debt after this round's loan, and the two rows sum to the reserve to the dollar", async () => {
  const { g, v0, d } = await started();
  const plan = d({ invest_cap: 3_000_000, debt_draw: 2_500_000 });
  const fin = { finance: v0.finance! };
  const grant = financingGrant(v0.own, fin, plan, equityCapacity(v0.own, fin));
  const rc = runningCostsAsGuard(v0, plan, grant);
  const money = moneyOutcome(v0, plan, g.infoCost())!;
  assert.ok(rc.interest > 10_000, `a real interest line: ${rc.interest}`);
  assert.equal(rc.debtAfter, v0.own.debt + grant.draw - grant.repay, "on the debt after the bank's actual grant, not the ask");
  assert.ok(Math.abs(rc.interest - rc.rate * rc.debtAfter) < 1e-6);
  assert.ok(Math.abs((rc.total - rc.interest) + rc.interest - money.reserve) < 1e-6, `rail ${rc.total} vs guard ${money.reserve}`);
  // the Round Table and the submit check say the same interest
  const table = planCash(plan, v0);
  assert.ok(Math.abs(table.interest - rc.interest) < 1e-6, `Round Table ${table.interest} vs rail ${rc.interest}`);
  if (money.lines.length) assert.match(money.lines.join(" "), /including \$[\d,]+ of interest/, money.lines.join(" | "));
  // and it is close to what the round then charges (the engine reprices only on a covenant breach)
  await g.play(plan);
  const v1 = await g.view();
  const charged = v1.ownResult!.pnl.interest;
  if (!v1.ownResult!.cost_of_capital.credit_rationed) assert.ok(Math.abs(charged - rc.interest) / rc.interest < 0.1, `charged ${charged} vs shown ${rc.interest}`);
});

test("item 2 · a plan that repays all the debt shows no interest line", async () => {
  const { v0, d } = await started();
  assert.ok(v0.own.debt > 0, "a fresh firm starts with a little bank debt");
  const plan = d({ debt_repay: v0.own.debt });
  const fin = { finance: v0.finance! };
  const rc = runningCostsAsGuard(v0, plan, financingGrant(v0.own, fin, plan, equityCapacity(v0.own, fin)));
  assert.equal(rc.debtAfter, 0);
  assert.equal(rc.interest, 0);
  assert.equal(planCash(plan, v0).interest, 0);
});

import { modulesOverride } from "drinkwars-engine";
import { emptyCityActions, keepUntouchedMarkets, marketsTouched, mergeDecision, withdrawEntry, withdrawnEntries, type CityActions } from "../src/game/cityActions.js";
import type { GameView } from "../src/game/controller.js";

test("item 1 · enter → withdraw → submit: the round sends no presence there, charges no entry fee, and builds nothing there", async () => {
  const { g, v0, d } = await started({ override: modulesOverride(["geography", "facilities"]) as never });
  const target = v0.markets.find((m) => !m.entered && m.kind !== "export")!;
  assert.ok(target, "a domestic market not yet entered");
  const lot = (target.lots ?? []).find((L) => L.unlocked && !L.occupant);
  const base = emptyCityActions(v0);
  const entered: CityActions = { ...base, markets: [...base.markets, target.id], builds: lot ? [{ type: "taproom", location: lot.district, market: target.id, lot: lot.id }] : [], supply: { [target.id]: 1_000 } };
  const before = mergeDecision(v0, d(), entered);
  assert.ok((before.market_presence?.[target.id] ?? 0) > 0, "entered: presence > 0 triggers the entry");
  const { actions, builds } = withdrawEntry(entered, target.id);
  assert.equal(builds.length, lot ? 1 : 0, "the build queued there is reported back");
  const after = mergeDecision(v0, d(), actions);
  assert.equal(after.market_presence?.[target.id], undefined, "no presence for the withdrawn city");
  assert.ok(!(after.build_facilities ?? []).some((b) => b.market === target.id), "no build queued there");
  assert.ok(!(target.id in (after.market_supply ?? {})), "no units offered there (an offer alone enters a market)");
  await g.play(after);
  const v1 = await g.view();
  assert.ok(!(v1.own.markets_entered ?? []).includes(target.id), "the firm did not enter it");
  assert.ok(!v1.events.some((e) => /^EXPANSION:/.test(e)), v1.events.filter((e) => /EXPANSION/.test(e)).join(" | "));
  // control: the same plan without the withdrawal enters the city (and pays its fee) — so the checks above aren't vacuous
  const c = await started({ override: modulesOverride(["geography", "facilities"]) as never });
  await c.g.play(mergeDecision(c.v0, c.d(), entered));
  const c1 = await c.g.view();
  assert.ok((c1.own.markets_entered ?? []).includes(target.id) && c1.events.some((e) => /^EXPANSION:/.test(e)), "control enters");
  assert.ok(c1.ownResult!.pnl.opex - v1.ownResult!.pnl.opex >= target.entryCost * 0.99, `the fee shows in opex: ${c1.ownResult!.pnl.opex} vs ${v1.ownResult!.pnl.opex}`);
});

test("item 1 · a team seat that already SENT an entry and withdraws it: the next submit carries the withdrawal", () => {
  const view = {
    round: 2,
    own: { id: "firm_1", markets_entered: ["home"], facilities: [] },
    modules: { facilities: { enabled: true, types: [], districts: [] } },
    markets: [{ id: "home", label: "Home", entered: true }, { id: "heartland", label: "Heartland", entered: false }],
    teamPlan: { composed: { market_presence: { home: 1, heartland: 0.6 } }, seats: [{ me: true, submitted: true, desk: "all", role: "ceo", name: "A", partial: { market_presence: { home: 1, heartland: 0.6 } }, touched: ["market_presence"] }] },
  } as unknown as GameView;
  const sent: CityActions = { ...emptyCityActions(view), markets: ["home", "heartland"] };
  assert.deepEqual(withdrawnEntries(view, sent), [], "nothing withdrawn yet");
  const { actions } = withdrawEntry(sent, "heartland");
  assert.deepEqual(actions.markets, ["home"], "back at the seeded set…");
  assert.deepEqual(withdrawnEntries(view, actions), ["heartland"]);
  assert.equal(marketsTouched(view, actions), true, "…but it is still a change to send");
  const form = { firm_id: "firm_1", market_presence: { home: 1, heartland: 0.6 } } as unknown as FirmDecision; // the form still mirrors the sent plan
  const out = keepUntouchedMarkets(view, mergeDecision(view, form, actions), form, actions);
  assert.deepEqual(out.market_presence, { home: 1 }, "the submit sends the markets without it");
  // a seat that never entered it sends nothing new about markets (no phantom edit)
  const quiet = { ...view, teamPlan: { ...view.teamPlan!, seats: [{ ...view.teamPlan!.seats[0], partial: { market_presence: { home: 1 } } }] } } as unknown as GameView;
  assert.equal(marketsTouched(quiet, emptyCityActions(quiet)), false);
});

import { receiptLines } from "../src/lib/planSummary.js";

test("item 3 · the receipt names a desk's moves on the plan that runs (prices as prices), every desk for a CEO", async () => {
  const { v0, d } = await started();
  const plan = d({ invest_cap: 200_000, debt_draw: 150_000 });
  const cmo = receiptLines(v0, plan, "commercial");
  assert.ok(cmo.some((l) => /^Price · .*\$7\.65/.test(l)), cmo.join(" | "));
  assert.deepEqual(receiptLines(v0, plan, "finance"), ["Draw debt $150,000"]);
  const all = receiptLines(v0, plan, "all");
  assert.ok(all.some((l) => /capacity \$200,000/.test(l)) && all.some((l) => /Draw debt/.test(l)) && all.some((l) => /^Price/.test(l)), all.join(" | "));
});

import { roundNews } from "../src/components/eventFeed.js";

test("11-16 review · a brewery's people and PR news is not a market shock: yours goes to your firm's card, a rival's to the Dispatch", () => {
  const ev = [
    "DEPARTURE: Hop Theory's head brewer leaves for another job",
    "NEGATIVE PR: Iron Kettle caught in a controversy (brand −3.0)",
    "MARKET SHIFT: mass beta_q +0.01",
  ];
  const n = roundNews(ev, "Hop Theory");
  assert.deepEqual(n.market.map((e) => e.title), ["Tastes are shifting"], "only the market-wide event is market news");
  assert.deepEqual(n.firm.map((e) => e.title), ["Key hire leaves"], "the reader's own departure is firm news");
});

// 11-16 (evening) · Devin's break-it pass: tick research, read it, untick — the report was free again.
test("break-it · solo research: the tick is the purchase — it stands for the round and the brew is charged for it", async () => {
  const { g, d } = await started();
  await g.play(d()); // round 1 has no last quarter to report on
  const v1 = await g.view();
  assert.equal(v1.infoActive, false);
  g.buyResearch();
  const v2 = await g.view();
  assert.equal(v2.infoActive, true, "bought: the box locks (Play derives infoLocked from infoActive)");
  const cash0 = v2.own.cash;
  // the form forces buy_info back on when locked; the controller charges what it is sent
  await g.play(d({ buy_info: true }));
  const v3 = await g.view();
  assert.equal(v3.infoActive, false, "scoped to one round");
  const opex = v3.ownResult!.pnl.opex_lines as Record<string, number> | undefined;
  assert.ok((opex?.market_research ?? 0) > 0, `the purchase was charged: ${JSON.stringify(opex)} (cash before ${cash0})`);
});

test("break-it · a price under the cost to brew is named in the submit check; formatting never prints -0.0 or a hyphen minus", async () => {
  const { priceLines } = await import("../src/lib/moneyCheck.js");
  const { fmt, minus } = await import("../src/labels.js");
  const { RATIO_DEFS, ratioDisplay } = await import("../src/lib/ratios.js");
  const { v0, d } = await started();
  const segs = v0.segments.filter((s) => s.active).map((s) => s.id);
  assert.deepEqual(priceLines(v0, d()), [], "a normal price passes");
  const lines = priceLines(v0, d({ price: { ...Object.fromEntries(segs.map((s) => [s, 7.65])), [segs[0]]: 0 } }));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\$0\.00 is under the ~\$[\d.]+ it costs to brew a drink/);
  assert.equal(minus("-0.0"), "0.0");
  assert.equal(minus("-1.5"), "−1.5");
  assert.equal(fmt.pct1(-0.0001), "0.0%");
  assert.equal(fmt.signed(-5), "−$5");
  const gm = RATIO_DEFS.find((r) => r.key === "grossMargin")!;
  const row = { revenue: 2, gross: -124_559 } as never;
  assert.equal(gm.compute(row), null, "no margin on $2 of revenue");
  assert.equal(ratioDisplay(gm, gm.compute(row)), "—");
});
