import { test } from "node:test";
import assert from "node:assert/strict";
import type { FirmDecision } from "drinkwars-engine";
import { SinglePlayerGame } from "../src/game/controller.js";
import { cockpitSignals } from "../src/deskMeta.js";
import { holdOrder, tankOutlook } from "../src/lib/tanks.js";
import { tankFit } from "../src/lib/sizing.js";
import { planCash } from "../src/lib/planSummary.js";
import { roundNews } from "../src/components/eventFeed.js";

// The 11-06 Chrome playtest of the v3 tree (one team game on the Sprint 2 set, one solo game on the Sprint 1 set):
// what a student read on the screen, pinned to the numbers the engine actually runs.

const started = async () => {
  const g = new SinglePlayerGame();
  await g.start({});
  const v0 = await g.view();
  const segs = v0.segments.filter((s) => s.active).map((s) => s.id);
  const d = (invest_cap: number): FirmDecision => ({
    firm_id: "firm_1", price: Object.fromEntries(segs.map((s) => [s, 7.65])), presence: Object.fromEntries(segs.map((s) => [s, 1])),
    invest_cap, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0, invest_T_gov: 0,
    debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, agreement_actions: [], exit_action: null,
  });
  return { g, v0, d };
};

test("11-06 · the Tanks card's hold-level order keeps next quarter level, with and without an order landing", async () => {
  const { g, v0, d } = await started();
  const cc = v0.capacity!;
  const t0 = tankOutlook(v0.own, cc, 0);
  const hold0 = holdOrder(t0, cc);
  const at0 = tankOutlook(v0.own, cc, hold0);
  assert.ok(Math.abs(at0.capNext - at0.capThis) < 1e-6, `ordering ${hold0} keeps ${at0.capThis} → ${at0.capNext}`);
  assert.ok(hold0 < t0.wear / cc.gain - 1, "it is not this quarter's wear (the card read $25,600 beside '+640')");
  await g.play(d(300_000)); // inside what the guard allows after the reserve: 75,000 units land at the next resolve
  const v1 = await g.view();
  const t1 = tankOutlook(v1.own, cc, 0);
  assert.ok(t1.landNow > 1, "last round's order lands at the coming resolve");
  const hold1 = holdOrder(t1, cc);
  const at1 = tankOutlook(v1.own, cc, hold1);
  assert.ok(Math.abs(at1.capNext - at1.capThis) < 1e-6);
  assert.ok(hold1 > t1.wear / cc.gain + 1, "with tanks landing, holding the bigger level costs more than this quarter's wear");
});

test("11-06 · tankFit: this quarter's tanks against last quarter's demand on the firm", () => {
  const binge = tankFit({ som: 71_287, caught: 10_634 }, 151_475); // the playtest's round 2
  assert.equal(binge.demand, 81_921);
  assert.ok(binge.covers && binge.ample);
  assert.equal(binge.idle, 151_475 - 81_921);
  assert.ok(Math.abs(binge.util - 81_921 / 151_475) < 1e-12);
  const short = tankFit({ som: 71_287, caught: 0 }, 57_600);
  assert.ok(!short.covers && !short.ample);
  const headroom = tankFit({ som: 60_000, caught: 0 }, 80_000);
  assert.ok(headroom.covers && !headroom.ample, "75% is headroom, not idle");
  assert.ok(!tankFit({ som: 0, caught: 0 }, 50_000).ample, "no demand read, no caution");
});

test("11-06 · the COO cockpit warns before a tank binge, and stops asking for tanks an earlier order already covers", async () => {
  const { g, d } = await started();
  await g.play(d(300_000));
  const v = await g.view();
  const capThis = tankOutlook(v.own, v.capacity!, 0).capThis;
  const s = v.sizing!;
  const sold = Object.values(v.ownResult!.segments).reduce((a, x) => a + x.q_sold, 0);
  const withSizing = (som: number, turned: number) => {
    v.sizing = { ...s, som, turnedAway: turned, caught: 0, idle: 0,
      rows: s.rows.map((r, i) => ({ ...r, turnedAway: i === 0 ? turned : 0, caught: 0, idle: 0 })),
      cats: s.cats.map((c, i) => ({ ...c, turnedAway: i === 0 ? turned : 0, caught: 0, idle: 0 })) };
    return cockpitSignals("operations", v);
  };
  // Demand at 40% of the tanks this quarter brews with: the forward-looking caution, before the order repeats.
  const quiet = withSizing(0.4 * capThis, 0);
  const ahead = quiet.find((x) => x.label === "Tanks ahead of demand");
  assert.ok(ahead, quiet.map((x) => x.label).join(", "));
  assert.equal(ahead!.value, "40%");
  assert.match(ahead!.read, /a smaller tank order saves money unless demand grows/); // 11-09 copy pass
  // Sold out last quarter, but the 75,000 units landing now cover all of it: no call for more tanks.
  const covered = withSizing(sold + 0.5 * sold, 0.5 * sold);
  assert.ok(capThis >= 1.5 * sold, `the landing order covers the sell-out: ${capThis} vs ${1.5 * sold}`);
  const card = covered.find((x) => x.label === "Turned away")!;
  assert.match(card.read, /so that demand is covered/);
  assert.doesNotMatch(card.read, /or more tanks/);
  // …and the utilization card doesn't ask for a build on last quarter's ceiling either.
  v.ownResult = { ...v.ownResult!, effective_cap: sold };
  const util = cockpitSignals("operations", v).find((x) => x.label === "Capacity utilization")!;
  assert.match(util.read, /arrive this quarter and cover that demand/); // 11-09 copy pass
  assert.doesNotMatch(util.read, /New tanks take a round/);
});

test("11-06 · results-page news: the firm's own notices are split from the market's, in the second person", () => {
  const you = "Alder Ale Works";
  const { market, firm } = roundNews([
    `BLOCKED: ${you} cannot pay for its whole plan — $650,000 of spending against $570,196 of cash and financing after $188,618 set aside for running costs; the bank lends $427,493 of the $1,000,000 asked. Cut: tank order $600,000 → $520,196`,
    `CREDIT: the bank lends ${you} only $427,493 of the $1,000,000 it asked — debt may not exceed 3× annual operating cash flow (EBITDA)`,
    `BLOCKED: Birch Brewing Co. cannot pay for its whole plan — $10 of spending against $5 of cash and financing. Cut: tank order $10 → $5`,
    "SHOCK fired: water (cost_spike, mag 0.35, unannounced) in Heartland",
  ], you);
  assert.deepEqual(firm.map((e) => e.title), ["Orders cut", "Loan cut"]);
  assert.match(String(firm[0].body), /^You couldn't pay for the whole plan\. It called for \$650,000 of spending, but cash and financing came to \$570,196/);
  assert.match(String(firm[1].body), /^The bank lent you only \$427,493 of the \$1,000,000 asked for\. The bank's reason: debt may not exceed 3× annual operating cash flow/);
  assert.equal(market.length, 1, `market news: ${market.map((e) => e.title).join(", ")}`);
  assert.ok(!market.some((e) => e.title === "Orders cut"), "a rival's cut is neither market news nor yours");
});

test("11-06 · the Round Table's cash check sets the quarter's running costs aside, as the rail and the engine do", async () => {
  const { g, v0 } = await started();
  void g;
  const d = { ...v0.standing!, invest_cap: 2_000_000, debt_draw: 0, equity_raise: 0, debt_repay: 0, dividend: 0 } as FirmDecision;
  const c = planCash(d, v0);
  assert.ok(c.reserve > 10_000, `a real reserve: ${c.reserve}`);
  assert.ok(Math.abs(c.after - (v0.own.cash + c.inflow - c.out - c.reserve)) < 1e-6);
});

// 11-06 (Devin): "make sure students don't think they're able to get one number but then actually have the engine
// resolve and give them only a fraction of it." The submit check, the Tanks card and the Round Table read moneyOutcome;
// these pin it to what the engine then does — to the dollar.
import { moneyOutcome } from "../src/lib/moneyCheck.js";

test("11-06 · the submit check's tank cut is the engine's, to the dollar, and says what it buys in units", async () => {
  const { g, v0, d } = await started();
  const plan = { ...d(1_200_000), invest_Q: 30_000, invest_B: 20_000 };
  const out = moneyOutcome(v0, plan, g.infoCost())!;
  assert.ok(out.tank, "a $1.2M order on $460k of cash is cut");
  assert.ok(out.tank!.kept > 100_000 && out.tank!.kept < 400_000, `kept ${out.tank!.kept}`);
  const line = out.lines.find((l) => l.startsWith("Tank order:"))!;
  assert.match(line, /^Tank order: \$1,200,000 → \$[\d,]+\. That adds [\d,]+ units of capacity next quarter, not 300,000\.$/, line);
  assert.ok(out.lines[0].startsWith("This plan spends $1,250,000. Your cash and the financing you'll get cover"), out.lines[0]); // 11-09 copy pass
  await g.play(plan);
  const v1 = await g.view();
  const cut = v1.events.map((e) => e.match(/Cut: tank order \$1,200,000 → \$([\d,]+)/)).find(Boolean);
  assert.ok(cut, v1.events.join(" | "));
  assert.equal(Number(cut![1].replace(/,/g, "")), Math.round(out.tank!.kept), "the preview's number is the engine's number");
  assert.ok(Math.abs(tankOutlook(v1.own, v1.capacity!, 0).landNow - out.tank!.unitsKept) < 1e-6, "and those units land at the next resolve");
});

test("11-06 · a plan the round can fund raises no check — no false alarms", async () => {
  const { g, v0, d } = await started();
  const out = moneyOutcome(v0, d(25_600), g.infoCost())!;
  assert.deepEqual(out.lines, []);
  assert.equal(out.tank, null);
  assert.equal(out.loan, null);
});

test("11-06 · the submit check's loan cap is the bank's answer, to the dollar (round 3: the cash-flow test)", async () => {
  const { g, d } = await started();
  await g.play(d(25_600));
  await g.play(d(25_600));
  const v2 = await g.view();
  const plan = { ...d(25_600), debt_draw: 5_000_000 };
  const out = moneyOutcome(v2, plan, g.infoCost())!;
  assert.ok(out.loan && out.loan.lent < 5_000_000, "the bank caps a $5M ask");
  const line = out.lines.find((l) => l.startsWith("Loan:"))!;
  assert.match(line, /^Loan: the bank lends \$[\d,]+ of the \$5,000,000 you asked for \(debt may not exceed 3× annual operating cash flow \(EBITDA\)\)\.$/, line); // 11-09 copy pass
  await g.play(plan);
  const v3 = await g.view();
  const lent = v3.events.map((e) => e.match(/^CREDIT: the bank lends .+? only (\$[\d,]+) of the \$5,000,000/)).find(Boolean);
  assert.ok(lent, v3.events.join(" | "));
  assert.equal(Number(lent![1].replace(/[$,]/g, "")), Math.round(out.loan!.lent));
});

test("11-06 · after the round, a cut tank order says what it bought in units", () => {
  const you = "Alder Ale Works";
  const { firm } = roundNews([
    `BLOCKED: ${you} cannot pay for its whole plan — $1,200,000 of spending against $398,539 of cash and financing after $61,461 set aside for running costs. Cut: tank order $1,200,000 → $398,539`,
  ], you, { tankUnits: (x) => x * 0.25 });
  assert.match(String(firm[0].body), /Cut to fit: tank order \$1,200,000 → \$398,539 \(99,635 units of new capacity instead of 300,000\)\.$/, String(firm[0].body));
});

test("11-06 · every panel's running costs are the guard's reserve, even after a big loan reprices the debt", async () => {
  const { g, v0, d } = await started();
  const plan = { ...d(3_000_000), debt_draw: 2_500_000 };
  const money = moneyOutcome(v0, plan, g.infoCost())!;
  assert.ok(money.reserve > 100_000, `a real reserve: ${money.reserve}`);
  const table = planCash(plan, v0);
  assert.ok(Math.abs(table.reserve - money.reserve) < 1e-6, `Round Table ${table.reserve} vs guard ${money.reserve}`);
  await g.play(plan);
  const v1 = await g.view();
  const set = v1.events.map((e) => e.match(/after (\$[\d,]+) set aside for running costs/)).find(Boolean);
  assert.ok(set, v1.events.join(" | "));
  assert.equal(Number(set![1].replace(/[$,]/g, "")), Math.round(money.reserve), "and it is the engine's");
});

