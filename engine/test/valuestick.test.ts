/**
 * 11-16 · The value stick (post-mortems; Devin's calls: WTP is an estimate from market research, WTS is suppliers +
 * staff and never just "cost"). The typical shopper's WTP must reconcile with the round's own demand: in a logit a
 * drink's odds against not buying are exp(βp·(WTP_typical − price)), so  WTP_typical − price = ln(share / outside share)/βp.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { initGame, resolveRound, resolveConfig, projectValueStick, deepMerge, modulesOverride, generateHiringMarket } from "../src/index.js";
import type { Config, FirmDecision, RoundResult, WorldState } from "../src/types.js";

const plan = (id: string, w: WorldState, price: number, x: Partial<FirmDecision> = {}): FirmDecision => ({
  firm_id: id,
  price: Object.fromEntries(w.segments.filter((s) => s.active).map((s) => [s.id, price])),
  presence: Object.fromEntries(w.segments.filter((s) => s.active).map((s) => [s.id, 1])),
  invest_cap: 0, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0, invest_T_gov: 0,
  debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, agreement_actions: [], exit_action: null, ...x,
});
const playRounds = (c: Config, n: number, own: (w: WorldState, r: number) => Partial<FirmDecision> = () => ({})) => {
  let w = initGame(c);
  const records: { round: number; result: RoundResult }[] = [];
  for (let r = 0; r < n; r++) {
    const out = resolveRound(w, w.firms.map((f, i) => plan(f.id, w, 6.5 + 0.4 * i, f.id === "firm_1" ? own(w, r) : {})), c);
    records.push({ round: out.result.round, result: out.result });
    w = out.world;
  }
  return { w, records };
};
const exact = (w: WorldState) => ({ seed: w.seed, round: w.round, sd: 0 }); // a survey with no error reads the truth

test("value stick · without market research there is no WTP at all (the true value is never sent)", () => {
  const c = resolveConfig();
  const { w, records } = playRounds(c, 2);
  const vs = projectValueStick(c, "firm_1", records, w.firms[0], null)!;
  assert.equal(vs.surveyed, false);
  for (const r of [...vs.rows, vs.all!]) assert.equal(r.wtp, null, `${r.id}: no WTP without research`);
});

test("value stick · the typical shopper's WTP reconciles with the round's demand; the middle half spans ± ln 3 / βp", () => {
  const c = resolveConfig();
  const { w, records } = playRounds(c, 2, (_w, r) => (r === 0 ? { invest_process: 40_000 } : {}));
  const vs = projectValueStick(c, "firm_1", records, w.firms[0], exact(w))!;
  const last = records[1].result;
  for (const row of vs.rows) {
    const mine = last.firm_results.find((r) => r.firm_id === "firm_1")!.segments[row.id as never];
    const inside = last.firm_results.reduce((s, r) => s + (r.segments[row.id as never]?.share ?? 0), 0);
    const bp = -mine.attraction.price / mine.price;
    assert.ok(Math.abs(row.wtp!.typical - row.price - Math.log(mine.share / (1 - inside)) / bp) < 1e-6, `${row.id}: typical WTP vs the logit`);
    assert.ok(Math.abs(row.wtp!.hi - row.wtp!.typical - Math.log(3) / bp) < 1e-9 && Math.abs(row.wtp!.typical - row.wtp!.lo - Math.log(3) / bp) < 1e-9, "middle half of shoppers");
    // a price above the typical shopper's WTP still sells: the buyers are the shoppers whose own WTP clears it
    assert.ok(row.wtp!.hi > row.price, `${row.id}: some shoppers value it above the price`);
  }
  // with survey error, the estimate moves but stays within two survey standard deviations
  const noisy = projectValueStick(c, "firm_1", records, w.firms[0], { seed: w.seed, round: w.round, sd: 0.1 })!;
  for (let i = 0; i < vs.rows.length; i++) assert.ok(Math.abs(noisy.rows[i].wtp!.typical / vs.rows[i].wtp!.typical - 1) <= 0.1 + 1e-9, "WTP carries half the survey error: within ±10%");
});

// The 11-16 rule (a stored game without costs.wts); the 11-18 crew / staff-need rule is pinned in wts_1118.test.ts.
const rule1116 = (c: Config): Config => { delete (c.costs as { wts?: unknown }).wts; return c; };

test("value stick · cost is the books; WTS = suppliers' need (brewing less the ~10% a brewery saves by owning its supplier)", () => {
  const c = rule1116(resolveConfig());
  const { w, records } = playRounds(c, 2, (_w, r) => (r === 0 ? { invest_process: 40_000 } : {}));
  const vs = projectValueStick(c, "firm_1", records, w.firms[0], null)!;
  const r1 = records[1].result.firm_results.find((r) => r.firm_id === "firm_1")!;
  for (const row of vs.rows) {
    assert.equal(row.unitCost, r1.unit_cost);
    assert.equal(row.cost, row.unitCost, "no staff: cost = the brewing cost");
    assert.ok(Math.abs(row.supplierMargin - 0.1) < 1e-9);
    assert.ok(Math.abs(row.wts - row.unitCost * 0.9) < 1e-9 && row.cost - row.wts > 0, "a supplier band, never cost = WTS");
    const m = row.moved!;
    assert.ok(m && Math.abs(m.costParts.reduce((s, p) => s + p.dollars, 0) - m.cost) < 0.005 * Math.max(1, m.costParts.length) + 1e-9, "cost moves add up");
  }
  assert.ok(vs.rows[0].moved!.costParts.some((p) => p.id === "process" && p.dollars < 0), "process spend shows as a cost move");
  assert.ok(vs.stocks.quality && vs.stocks.brand, "the quality and brand stocks, then and now");
  // a brewery that owns its supplier keeps that margin: suppliers' need = its cost
  const owner = projectValueStick(c, "firm_1", records, { ...w.firms[0], vertical_assets: [{ id: "hop_supplier", acquired_round: 0 }] }, null)!;
  assert.equal(owner.rows[0].supplierMargin, 0);
  assert.equal(owner.rows[0].wts, owner.rows[0].cost);
});

test("value stick · staff: cost adds pay per drink; WTS adds the job-market rate for the same people", () => {
  const c = rule1116(deepMerge(resolveConfig(), modulesOverride(["employees"]) as never) as Config);
  const { w, records } = playRounds(c, 2, (w0, r) => (r === 0 ? { hire_employees: [generateHiringMarket(c, w0.seed, w0.round)[0].id] } : {}));
  const firm = w.firms.find((f) => f.id === "firm_1")!;
  const vs = projectValueStick(c, "firm_1", records, firm, null)!;
  const row = vs.rows[0];
  assert.ok(vs.peopleOn && row.staff > 0);
  assert.ok(Math.abs(row.cost - (row.unitCost + row.staff)) < 1e-9);
  const e = firm.employees![0];
  const ratio = (c.modules!.employees!.roles.find((x) => x.id === e.role)!.base_salary * (0.55 + 0.15 * e.skill)) / e.salary;
  assert.ok(Math.abs(row.wts - (row.unitCost * 0.9 + row.staff * ratio)) < 1e-9);
});

test("value stick · geography: each city counts by its drinks", () => {
  const c = deepMerge(resolveConfig(), modulesOverride(["geography"]) as never) as Config;
  const { w, records } = playRounds(c, 2, () => ({ market_presence: Object.fromEntries((c.modules!.geography!.markets ?? []).filter((m) => m.kind !== "export").map((m) => [m.id, 1])) }));
  const vs = projectValueStick(c, "firm_1", records, w.firms[0], exact(w))!;
  for (const row of vs.rows) assert.ok(Number.isFinite(row.wtp!.typical) && row.wtp!.typical > 0);
});

test("value stick · a result recorded before 11-16 (no outside option) reads as not available", () => {
  const c = resolveConfig();
  const { records } = playRounds(c, 1);
  const old = JSON.parse(JSON.stringify(records)) as typeof records;
  for (const r of old[0].result.firm_results) for (const s of Object.values(r.segments)) delete (s as { outside?: number }).outside;
  assert.equal(projectValueStick(c, "firm_1", old, null, null), null);
});
