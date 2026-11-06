/**
 * v3 audit (2026-11-05): the bank's cash-flow test (finance.cash_flow_lending), the affordability guard's
 * running-cost reserve (affordability_guard.reserve_running_costs), and the debt-rate helper the reserve prices
 * interest with. Both rules are new-game defaults; absent ⇒ the v3 engine as first built.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { initGame, resolveRound, resolveConfig, creditCapacity, creditLimits, creditReason, debtRate, applyAffordabilityGuard, runningCostEstimate, deepMerge } from "../src/index.js";
import type { Config, FirmDecision, FirmState, WorldState } from "../src/types.js";

const zero = (id: string, w: WorldState): FirmDecision => ({
  firm_id: id,
  price: Object.fromEntries(w.segments.filter((s) => s.active).map((s) => [s.id, 7])),
  presence: Object.fromEntries(w.segments.filter((s) => s.active).map((s) => [s.id, 1])),
  invest_cap: 0, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0, invest_T_gov: 0,
  debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, agreement_actions: [], exit_action: null,
});
const firm = (w: WorldState, id: string): FirmState => w.firms.find((f) => f.id === id)!;
const play = (w: WorldState, c: Config, id: string, patch: Partial<FirmDecision>) =>
  resolveRound(w, w.firms.map((x) => (x.id === id ? { ...zero(x.id, w), ...patch } : zero(x.id, w))), c);
const with_ = (c: Config, o: object): Config => deepMerge(c as never, o as never) as Config;
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

test("cash-flow lending: no history ⇒ the leverage test alone; with history, bank debt ≤ 3× annual EBITDA; EBITDA ≤ 0 ⇒ nothing", () => {
  const c = resolveConfig();
  const cf = c.finance.cash_flow_lending!;
  const w = initGame(c);
  const f = firm(w, "firm_1");
  const equity = f.paid_in_capital + f.retained_earnings;
  const fresh = creditLimits(f, c);
  assert.equal(fresh.byCashFlow, null, "round 1: no operating history, so the bank lends against equity");
  assert.ok(near(fresh.capacity, c.finance.max_leverage * equity - f.debt));
  assert.equal(fresh.binding, "leverage");
  // The bank wants two quarters of books (11-06): after one, still the equity test alone — even on a loss.
  f.ebitda_history = [-10_000];
  assert.equal(creditLimits(f, c).byCashFlow, null, "one quarter of books is not yet a track record");
  assert.ok(near(creditLimits(f, c).capacity, fresh.capacity));
  // A year of $50k quarters: annual EBITDA $200k ⇒ debt may reach $600k ⇒ $520k of room over the $80k owed.
  f.ebitda_history = [50_000, 50_000, 50_000, 50_000];
  const lim = creditLimits(f, c);
  assert.ok(near(lim.annualEbitda!, 200_000));
  assert.ok(near(lim.byCashFlow!, cf.ebitda_multiple * 200_000 - f.debt));
  assert.equal(lim.binding, "cash_flow", "the cash-flow test is the lower of the two");
  assert.equal(creditCapacity(f, c), lim.byCashFlow);
  assert.match(creditReason(lim, equity, c), /3× annual operating cash flow/);
  // Only the trailing window counts: an old bad year drops out.
  f.ebitda_history = [-900_000, 50_000, 50_000, 50_000, 50_000];
  assert.ok(near(creditLimits(f, c).annualEbitda!, 200_000), "trailing four quarters, not the whole history");
  // Losses: nothing, with the reason in the firm's words and the bank's.
  f.ebitda_history = [-10_000, -20_000];
  const broke = creditLimits(f, c);
  assert.equal(broke.capacity, 0);
  assert.match(creditReason(broke, equity, c), /at or below zero over the last 4 quarters/);
  assert.match(creditReason(broke, equity, c, "your"), /yours has been at or below zero/);
  // Equity gone beats everything: that reason comes first.
  assert.match(creditReason(broke, -1, c), /used up its equity/);
  // Off (a stored pre-audit game): the leverage test alone, whatever the history.
  const legacy = with_(c, { finance: { cash_flow_lending: null } });
  delete (legacy.finance as { cash_flow_lending?: unknown }).cash_flow_lending;
  assert.ok(near(creditCapacity(f, legacy), c.finance.max_leverage * equity - f.debt));
});

test("cash-flow lending reaches the round: a loss-making firm's draw is refused with the cash-flow reason, and EBITDA history accrues each round", () => {
  const c = resolveConfig();
  const w = initGame(c);
  const r1 = play(w, c, "firm_2", {});
  const f1 = firm(r1.world, "firm_2");
  assert.equal(f1.ebitda_history!.length, 1, "one quarter of history after one round");
  const r = r1.result.firm_results.find((x) => x.firm_id === "firm_2")!;
  assert.ok(near(f1.ebitda_history![0], r.pnl.ebit + r.pnl.depreciation, 1e-6));
  // Force a loss-making history, then ask for a loan the leverage test alone would grant.
  f1.ebitda_history = [-50_000, -50_000];
  const r2 = play(r1.world, c, "firm_2", { debt_draw: 200_000 });
  const ev = r2.result.events.find((e) => e.startsWith("CREDIT REFUSED: the bank lends firm_2"));
  assert.ok(ev, r2.result.events.filter((e) => /CREDIT/.test(e)).join(" | "));
  assert.match(ev!, /operating cash flow/);
  assert.equal(r2.result.firm_results.find((x) => x.firm_id === "firm_2")!.cash_flow.cf_lines?.financing.debt_draw ?? 0, 0, "nothing was lent");
});

test("the guard's reserve: orders are sized after the quarter's running costs, and the notice says so", () => {
  const c = resolveConfig();
  const w = initGame(c);
  const f = firm(w, "firm_3");
  const d: FirmDecision = { ...zero("firm_3", w), invest_cap: f.cash + 500_000 }; // more tanks than the cash
  const g = applyAffordabilityGuard(f, d, c, 0);
  const lev = Math.min(10, f.debt / Math.max(f.paid_in_capital + f.retained_earnings, 1e-9));
  const expectReserve = runningCostEstimate(f, d, c, 0, { debtAfter: f.debt, rate: debtRate(lev, f.T_inv, c) }).total;
  assert.ok(expectReserve > 10_000, `a real reserve: ${expectReserve}`);
  assert.ok(near(g.reserve, expectReserve, 1e-6));
  assert.ok(near(g.sources, f.cash - expectReserve, 1e-6), "sources are net of the reserve");
  assert.ok(near(g.decision.invest_cap, f.cash - expectReserve, 1), "the tank order is trimmed to what is left after the bills");
  assert.match(g.events[0], /set aside for running costs/);
  // Off: every dollar may go to tanks (the v3 rule as first built).
  const bare = with_(c, { finance: { affordability_guard: { mode: "scale", reserve_running_costs: false } } });
  const g0 = applyAffordabilityGuard(f, d, bare, 0);
  assert.equal(g0.reserve, 0);
  assert.ok(near(g0.decision.invest_cap, f.cash, 1));
  assert.doesNotMatch(g0.events[0], /set aside/);
});

test("debtRate is the books' own pre-penalty rate", () => {
  const c = resolveConfig();
  const w = initGame(c);
  const out = play(w, c, "firm_4", {});
  const r = out.result.firm_results.find((x) => x.firm_id === "firm_4")!;
  if (r.cost_of_capital.coverage >= c.finance.coverage_threshold) {
    assert.ok(near(debtRate(r.cost_of_capital.leverage, firm(out.world, "firm_4").T_inv, c), r.cost_of_capital.r_debt, 1e-9));
  }
});
