import { test } from "node:test";
import assert from "node:assert/strict";
import { creditCapacity, equityCapacity, overdraftLimit, modulesOverride } from "drinkwars-engine";
import type { FirmDecision } from "drinkwars-engine";
import { SinglePlayerGame } from "../src/game/controller.js";
import { cockpitSignals } from "../src/deskMeta.js";
import { tankOutlook } from "../src/lib/tanks.js";
import { planCash } from "../src/lib/planSummary.js";

// DW-084 (v3): the cockpit says what the quarter can be funded with, and the COO's capacity alarm
// fires only on shoppers who picked the firm, in markets it sells in, and found it sold out.
const solo = async () => {
  const g = new SinglePlayerGame();
  await g.start({ override: modulesOverride(["geography"]) as never });
  const v0 = await g.view();
  const segs = v0.segments.filter((s) => s.active).map((s) => s.id);
  const d: FirmDecision = {
    firm_id: "firm_1", price: Object.fromEntries(segs.map((s) => [s, 6])), presence: Object.fromEntries(segs.map((s) => [s, 1])),
    invest_cap: 0, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0, invest_T_gov: 0,
    debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, agreement_actions: [], exit_action: null,
  };
  await g.play(d);
  return g.view();
};

test("the solo view carries TAM ⊇ SAM ⊇ SOM, and a market the firm never entered is outside its SAM", async () => {
  const v = await solo();
  const s = v.sizing!;
  assert.ok(s && s.tam >= s.sam && s.sam >= s.som && s.som > 0);
  const away = s.rows.filter((r) => !r.youSell);
  assert.ok(away.length > 0, "a home-only firm has markets it doesn't sell in");
  for (const r of away) assert.equal(r.poolYours, 0);
});

test("the CFO's card states the bank's, the investors' and the overdraft's limits from the engine's own functions", async () => {
  const v = await solo();
  const card = cockpitSignals("finance", v).find((x) => x.label === "Cash to work with")!;
  assert.ok(card, "the card is there");
  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const fin = { finance: v.finance! };
  // 11-07 readability pass: the limits ride as label → value rows under the cash, not a sentence.
  const row = (k: string) => card.rows?.find((r) => r.k === k)?.v ?? "";
  assert.equal(row("Bank lends up to"), money(creditCapacity(v.own, fin)));
  assert.equal(row("Investors put in up to"), money(equityCapacity(v.own, fin)));
  assert.match(row("Emergency overdraft up to"), new RegExp(`^\\${money(overdraftLimit(v.own, fin))} · at a penalty rate$`)); // 11-09 copy pass
});

test("the COO's 'Turned away' card: only a sold-out firm, only material, only inside its own markets", async () => {
  const v = await solo();
  const s = v.sizing!;
  const sold = Object.values(v.ownResult!.segments).reduce((a, x) => a + x.q_sold, 0);
  // `turned` in the first category; `caught` = rivals' overflow served in the second; `idle` = the tanks the
  // utilization leaves unused, allotted to the second category (the engine reports idle per category).
  const signals = (util: number, turned: number, caught = 0) => {
    const cap = sold / util;
    const idle = Math.max(0, cap - sold);
    v.ownResult = { ...v.ownResult!, effective_cap: cap };
    v.sizing = { ...s, turnedAway: turned, caught, idle,
      rows: s.rows.map((r, i) => ({ ...r, turnedAway: i === 0 ? turned : 0, caught: i === 0 ? caught : 0, idle: i === 0 ? idle : 0 })),
      cats: s.cats.map((c, i) => ({ ...c, turnedAway: i === 0 ? turned : 0, caught: i === 1 ? caught : 0, idle: i === 1 ? idle : 0 })) };
    return cockpitSignals("operations", v);
  };
  const labels = (util: number, turned: number, caught = 0) => signals(util, turned, caught).map((x) => x.label);
  const fire = (util: number, turned: number) => labels(util, turned).includes("Turned away");
  const big = Math.max(0.1 * sold, 1_000) + 1;
  assert.equal(fire(0.97, big), true, "sold out + material ⇒ the card");
  assert.equal(fire(0.9, big), false, "tanks to spare ⇒ no tank case, whatever the gap");
  // …and (v3 audit) those spare tanks beside a sell-out are the allocation problem, whatever the utilization:
  // the old read stayed silent at 52% utilization while a firm turned away 22,000 shoppers in Lagers with
  // half its tanks idle in Craft.
  const spare = signals(0.9, big).find((x) => x.label === "Capacity in the wrong place");
  assert.ok(spare, labels(0.9, big).join(", "));
  assert.match(spare!.read, /units stood idle/);
  assert.match(spare!.read, /Moving that capacity toward/); // 11-09 copy pass
  assert.ok(signals(0.52, 3 * big).some((x) => x.label === "Capacity in the wrong place"), "52% utilization, big sell-out ⇒ wrong place");
  assert.equal(fire(0.97, Math.max(0.1 * sold, 1_000) - 1), false, "a sliver ⇒ no card");
  // Sold out in one category while selling rivals' overflow in another: an allocation problem, not a tank one.
  const split = labels(0.97, 3 * big, 3 * big - 10);
  assert.ok(split.includes("Capacity in the wrong place") && !split.includes("Turned away"), split.join(", "));
  const tanks = signals(0.97, 3 * big, big).find((x) => x.label === "Turned away");
  assert.ok(tanks, "a net shortfall past the floor is still a capacity case");
  assert.match(tanks!.read, /even counting the [\d,]+ units you had spare elsewhere/);
  // Demand in markets the firm never entered isn't in `turnedAway` at all — the old card read q_desired − sold.
  v.ownResult = { ...v.ownResult!, effective_cap: sold / 0.97 };
  v.sizing = { ...s, turnedAway: 0, caught: 0, rows: s.rows.map((r) => ({ ...r, turnedAway: 0, caught: 0 })), cats: s.cats.map((c) => ({ ...c, turnedAway: 0, caught: 0 })) };
  const seg = Object.keys(v.ownResult.segments)[0];
  v.ownResult.segments = { ...v.ownResult.segments, [seg]: { ...v.ownResult.segments[seg], q_desired: v.ownResult.segments[seg].q_sold + 10 * big } };
  assert.equal(cockpitSignals("operations", v).some((x) => x.label === "Turned away"), false);
});

test("the CFO's 'Credit' card says what the engine does: repriced on a covenant breach, capped or refused by leverage — never 'capping' beside 'lends up to'", async () => {
  const v = await solo();
  const fin = v.finance!;
  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const credit = () => cockpitSignals("finance", v).find((x) => x.label === "Credit");
  v.ownResult = { ...v.ownResult!, cost_of_capital: { ...v.ownResult!.cost_of_capital, credit_rationed: true, coverage: fin.coverage_threshold - 0.1 } };
  const breach = credit()!;
  assert.equal(breach.value, "Penalty rate"); // 11-09 copy pass
  assert.match(breach.read, new RegExp(`still lends up to \\${money(creditCapacity(v.own, { finance: fin }))}`), breach.read);
  v.ownResult = { ...v.ownResult, cost_of_capital: { ...v.ownResult.cost_of_capital, coverage: 5 } };
  assert.equal(credit()!.value, "Capped", "flagged with healthy cover ⇒ the leverage cap cut last quarter's draw");
  v.own = { ...v.own, debt: fin.max_leverage * (v.own.paid_in_capital + v.own.retained_earnings) + 1 };
  const refused = credit()!;
  assert.equal(refused.value, "Refused");
  assert.match(refused.read, /already sits at 3× your equity/);
  v.ownResult = { ...v.ownResult, cost_of_capital: { ...v.ownResult.cost_of_capital, credit_rationed: false } };
  assert.equal(credit(), undefined, "no flag ⇒ no card");
});

test("the Tanks card's outlook is the engine's rule: this quarter brews on cap − wear + what lands; this round's order comes online the quarter after", async () => {
  const g = new SinglePlayerGame();
  await g.start({});
  const v0 = await g.view();
  const cc = v0.capacity!;
  const segs = v0.segments.filter((s) => s.active).map((s) => s.id);
  const d = (invest_cap: number): FirmDecision => ({
    firm_id: "firm_1", price: Object.fromEntries(segs.map((s) => [s, 6])), presence: Object.fromEntries(segs.map((s) => [s, 1])),
    invest_cap, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0, invest_T_gov: 0,
    debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, agreement_actions: [], exit_action: null,
  });
  const order = 200_000; // inside what the guard allows after the running-cost reserve, so nothing is trimmed
  const t0 = tankOutlook(v0.own, cc, order);
  assert.ok(Math.abs(t0.added - order * cc.gain) < 1e-6, "linear conversion: $ × gain");
  assert.ok(t0.capThis < v0.own.cap, "the coming quarter wears the stock before this order can land");
  await g.play(d(order));
  const v1 = await g.view();
  assert.ok(Math.abs(v1.own.cap - t0.capThis) < 1e-6, `this quarter brewed with ${v1.own.cap}; the card said ${t0.capThis}`);
  const t1 = tankOutlook(v1.own, cc, 0);
  assert.ok(Math.abs(t1.landNow - order * cc.gain) < 1e-6, "last round's order lands at the coming resolve");
  assert.ok(Math.abs(t1.capThis - t0.capNext) < 1e-6, "…which is what the card promised as 'next quarter'");
  await g.play(d(0));
  const v2 = await g.view();
  assert.ok(Math.abs(v2.own.cap - t1.capThis) < 1e-6, `after the order lands: ${v2.own.cap} vs ${t1.capThis}`);
  // The COO's capacity case says the order is coming before it asks for more tanks.
  const s = v1.sizing!;
  const sold = Object.values(v1.ownResult!.segments).reduce((a, x) => a + x.q_sold, 0);
  v1.ownResult = { ...v1.ownResult!, effective_cap: sold / 0.99 };
  v1.sizing = { ...s, turnedAway: 0.5 * sold, caught: 0, idle: 0, rows: s.rows.map((r, i) => ({ ...r, turnedAway: i === 0 ? 0.5 * sold : 0, caught: 0, idle: 0 })), cats: s.cats.map((c, i) => ({ ...c, turnedAway: i === 0 ? 0.5 * sold : 0, caught: 0, idle: 0 })) };
  const card = cockpitSignals("operations", v1).find((x) => x.label === "Turned away")!;
  assert.match(card.read, new RegExp(`The ${Math.round(order * cc.gain).toLocaleString("en-US")} units you ordered earlier arrive this quarter first`), card.read); // 11-09 copy pass
});

test("the Round Table's cash check counts the financing the bank will grant, not the raw ask", async () => {
  const v = await solo();
  const ask = 5_000_000;
  const d = { ...v.standing!, debt_draw: ask, equity_raise: 0, debt_repay: 0, dividend: 0 } as FirmDecision;
  const cap = creditCapacity(v.own, { finance: v.finance! });
  assert.ok(cap < ask, "the ask is past the leverage cap");
  const c = planCash(d, v);
  assert.ok(Math.abs(c.inflow - cap) < 1, `financing counted ${c.inflow}; the bank lends ${cap}`);
});

test("the Tuning Board's knee knob: untouched ⇒ the default 20; moved ⇒ that knee; far end ⇒ null (off) that survives JSON", async () => {
  const { tuningToOverride, tuningDefaults } = await import("../src/screens/TuningBoard.js");
  const { resolveConfig } = await import("drinkwars-engine");
  const viaJson = (vals: Record<string, number>) => resolveConfig(JSON.parse(JSON.stringify(tuningToOverride(vals))));
  assert.equal(viaJson(tuningDefaults()).demand.stock_knee, 20);
  assert.equal(viaJson({ ...tuningDefaults(), stock_knee: 30 }).demand.stock_knee, 30);
  assert.equal(viaJson({ ...tuningDefaults(), stock_knee: 60 }).demand.stock_knee, null, "off is stored, not dropped (absent would mean 20)");
});
