/**
 * 11-18 · Break-it pass, engine rules for new games (each absent from a stored config ⇒ the old rule; parity in
 * fixtures/legacy.ts pre1118 and the sprint replays):
 *  1. Staff need (costs.wts): the pay staff need falls as Taproom community grows and rises as it runs down; morale is
 *     judged against it, and the value stick's WTS splits brewing cost into ingredients and crew.
 *  2. Market pillar on drinks sold (scoring.market_basis "sold"), not shoppers' first choices.
 *  3. Equity gate on business value (finance.equity_gate.basis "business"): cash raised can't lift the next cap.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { initGame, resolveRound, resolveConfig, projectValueStick, staffNeedFactor, marketRate, equityCapacity, firmValuation } from "../src/index.js";
import { resolveEmployees } from "../src/engine/employees.js";
import { loadConfig } from "../src/config/load.js";
import { modulesOverride } from "../src/config/modules.js";
import { pre1118 } from "./fixtures/legacy.js";
import type { Config, Employee, FirmDecision, FirmId, RoundResult, WorldState } from "../src/types.js";

const plan = (firm_id: FirmId, w: WorldState, price: number, x: Partial<FirmDecision> = {}): FirmDecision => ({
  firm_id,
  price: Object.fromEntries(w.segments.filter((s) => s.active).map((s) => [s.id, price])),
  presence: Object.fromEntries(w.segments.filter((s) => s.active).map((s) => [s.id, 1])),
  invest_cap: 0, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0, invest_T_gov: 0,
  debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, agreement_actions: [], exit_action: null, ...x,
});

test("staff need: 1 at the starting Taproom community, lower above it, higher below, bounded by trust_max; 1 without costs.wts", () => {
  const c = resolveConfig();
  const t0 = c.init.starting_T_emp, max = c.costs.wts!.trust_max;
  assert.equal(staffNeedFactor(t0, c), 1);
  assert.ok(staffNeedFactor(t0 + 30, c) < staffNeedFactor(t0 + 10, c) && staffNeedFactor(t0 + 10, c) < 1);
  assert.ok(Math.abs(staffNeedFactor(t0 + 30, c) - (1 - (max * 30) / 50)) < 1e-12, "T_emp 40: 12% below the going pay");
  assert.ok(staffNeedFactor(0, c) > 1 && staffNeedFactor(0, c) < 1 + max, "a run-down community needs a premium");
  assert.ok(staffNeedFactor(1e9, c) > 1 - max - 1e-9);
  assert.equal(staffNeedFactor(t0 + 30, pre1118(resolveConfig())), 1);
});

test("staff need: the same pay keeps morale at a strong-community brewery and loses it at a run-down one", () => {
  const c = loadConfig(modulesOverride(["employees"]));
  const role = c.modules!.employees!.roles.find((r) => r.id === "head_brewer")!;
  const salary = Math.round(marketRate(role.base_salary, 4) * 0.95); // 5% under the going pay
  const moraleAfter = (cfg: Config, tEmp: number) => {
    const w = initGame(cfg);
    const e: Employee = { id: "emp_0_0", name: "Hana B.", role: "head_brewer", skill: 4, salary, satisfaction: 0.6, tenure_rounds: 0, hired_round: 0, avatar_seed: "x" };
    w.firms[0].employees = [e];
    w.firms[0].rounds_below_health = 0;
    w.firms[0].T_emp = tEmp;
    resolveEmployees(w, new Map(), cfg, w.round);
    return w.firms[0].employees![0].satisfaction;
  };
  assert.ok(Math.abs(moraleAfter(c, 60) - 0.63) < 1e-9, "T_emp 60: need ≈ 86% of the going pay, so 95% of it is enough (+0.03)");
  assert.ok(Math.abs(moraleAfter(c, c.init.starting_T_emp) - 0.54) < 1e-9, "starting community: 95% of the going pay is short (−0.06)");
  assert.ok(Math.abs(moraleAfter(pre1118(loadConfig(modulesOverride(["employees"]))), 60) - 0.54) < 1e-9, "a stored game: the going pay, whatever the community");
});

test("value stick: brewing cost splits into ingredients and crew; WTS = suppliers' need + crew need, and falls as community grows", () => {
  const c = resolveConfig();
  const run = (tempSpend: number) => {
    let w = initGame(c);
    const records: { round: number; result: RoundResult }[] = [];
    for (let r = 0; r < 3; r++) {
      const out = resolveRound(w, w.firms.map((f, i) => plan(f.id, w, 6.5 + 0.4 * i, f.id === "firm_1" ? { invest_T_emp: tempSpend } : {})), c);
      records.push({ round: out.result.round, result: out.result });
      w = out.world;
    }
    return projectValueStick(c, "firm_1", records, w.firms[0], null)!;
  };
  const base = run(0), invested = run(150_000);
  for (const vs of [base, invested]) {
    const row = vs.rows[0];
    assert.ok(vs.crewSplit && Math.abs(row.crew - row.unitCost * 0.3) < 1e-9, "crew = 30% of brewing cost");
    assert.ok(Math.abs(row.wts - (row.unitCost * (0.7 - row.supplierMargin) + row.crew * row.needFactor)) < 1e-9);
    assert.ok(row.cost > row.wts, "a surplus band for suppliers and staff, never WTS = cost");
  }
  assert.ok(invested.crewSplit!.tEmp > base.crewSplit!.tEmp && invested.rows[0].needFactor < base.rows[0].needFactor, "community lowers the crew's need");
  assert.ok(invested.rows[0].wts / invested.rows[0].cost < base.rows[0].wts / base.rows[0].cost, "WTS falls relative to cost");
});

test("market pillar: drinks-sold share, so a near-free price can't buy share it can't brew; first-choice share on a stored game", () => {
  const go = (c: Config) => {
    const w = initGame(c);
    const out = resolveRound(w, w.firms.map((f) => plan(f.id, w, f.id === "firm_1" ? 0.5 : 7.5)), c);
    return out.result;
  };
  const sold = go(resolveConfig());
  const totals: Record<string, number> = {};
  for (const r of sold.firm_results) for (const [s, x] of Object.entries(r.segments)) totals[s] = (totals[s] ?? 0) + x.q_sold;
  for (const r of sold.firm_results) {
    const want = Object.entries(r.segments).reduce((a, [s, x]) => a + (totals[s] > 0 ? x.q_sold / totals[s] : 0), 0);
    assert.ok(Math.abs(r.scorecard_raw.market - want) < 1e-12, `${r.firm_id}: raw market = Σ share of drinks sold`);
  }
  const old = go(pre1118(resolveConfig()));
  const cheap = old.firm_results.find((r) => r.firm_id === "firm_1")!;
  assert.ok(Math.abs(cheap.scorecard_raw.market - Object.values(cheap.segments).reduce((a, x) => a + x.share, 0)) < 1e-12, "stored game: Σ first-choice share");
  const cheapNew = sold.firm_results.find((r) => r.firm_id === "firm_1")!;
  assert.ok(cheapNew.scorecard_raw.market < cheap.scorecard_raw.market, "the $0.50 firm's first-choice share counted shoppers it could not serve");
});

test("equity gate, business basis: a raise does not lift next quarter's cap (book basis compounds)", () => {
  const capAfterRaise = (c: Config) => {
    const w = initGame(c);
    const cap0 = equityCapacity(w.firms[0], c);
    const out = resolveRound(w, w.firms.map((f) => plan(f.id, w, 7.5, f.id === "firm_1" ? { equity_raise: cap0 } : {})), c);
    const f1 = out.world.firms.find((f) => f.id === "firm_1")!, f2 = out.world.firms.find((f) => f.id === "firm_2")!;
    return { cap0, raisedCap: equityCapacity(f1, c), peerCap: equityCapacity(f2, c), cash: f1.cash - f2.cash };
  };
  const biz = capAfterRaise(resolveConfig());
  assert.ok(biz.cash > 0.9 * biz.cap0, "the raise landed as cash");
  assert.ok(Math.abs(biz.raisedCap - biz.peerCap) < 0.02 * biz.peerCap, `business basis: same cap as a firm that raised nothing (${biz.raisedCap} vs ${biz.peerCap})`);
  const book = capAfterRaise(pre1118(resolveConfig()));
  assert.ok(book.raisedCap - book.peerCap > 0.4 * book.cash, "book basis: the cash raised lifts the next cap by about half of it");
  const f = initGame(resolveConfig()).firms[0];
  assert.equal(equityCapacity(f, resolveConfig()), Math.max(0, 0.5 * (firmValuation(f, resolveConfig(), true) - f.cash)));
});
