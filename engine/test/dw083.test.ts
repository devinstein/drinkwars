/**
 * DW-083 — Sprint 2 classroom findings: the bank's limit is the form's limit (item 1), a cut draw is
 * news (6), a repayment can't overdraw the firm (3), orders must fit cash + financing (2), the
 * emergency overdraft (4b), an unaffordable vertical asset says so (7), and phantom competitors (5).
 * Every model change is config-gated: absent ⇒ the Sprint 1–2 engine (the class fixtures replay). Since v3
 * (DW-084) new games get them all by default, so each legacy check strips them with `preDw083`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { initGame, resolveRound, resolveConfig, creditCapacity, financingGrant, equityCapacity, applyAffordabilityGuard, covenantCashFloor, deepMerge } from "../src/index.js";
import { modulesOverride } from "../src/config/modules.js";
import { preDw083 } from "./fixtures/legacy.js";
import type { Config, FirmDecision, FirmState, WorldState } from "../src/types.js";

const zero = (id: string, w: WorldState): FirmDecision => ({
  firm_id: id,
  price: Object.fromEntries(w.segments.filter((s) => s.active).map((s) => [s.id, 7])),
  presence: Object.fromEntries(w.segments.filter((s) => s.active).map((s) => [s.id, 1])),
  invest_cap: 0, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0, invest_T_gov: 0,
  debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, agreement_actions: [], exit_action: null,
});
const firm = (w: WorldState, id: string): FirmState => w.firms.find((f) => f.id === id)!;
// Balanced edits (the engine re-checks assets = debt + equity every round): cash moves against
// retained earnings; extra debt arrives as cash; wiping equity moves it into debt.
const setCash = (f: FirmState, x: number) => { f.retained_earnings += x - f.cash; f.cash = x; };
const addDebt = (f: FirmState, x: number) => { f.debt += x; f.cash += x; };
const wipeEquity = (f: FirmState) => { const e = f.paid_in_capital + f.retained_earnings + 1; f.retained_earnings -= e; f.debt += e; };
const play = (w: WorldState, c: Config, id: string, patch: Partial<FirmDecision>) =>
  resolveRound(w, w.firms.map((x) => (x.id === id ? { ...zero(x.id, w), ...patch } : zero(x.id, w))), c);
const with_ = (c: Config, o: object): Config => deepMerge(c as never, o as never) as Config;
const resultOf = (out: ReturnType<typeof resolveRound>, id: string) => out.result.firm_results.find((r) => r.firm_id === id)!;

test("item 1: creditCapacity is the draw the books grant (and the form's 'the bank will lend up to')", () => {
  const c = resolveConfig();
  const w = initGame(c);
  const f = firm(w, "firm_1");
  for (const [raise, repay] of [[0, 0], [200_000, 0], [0, 50_000], [150_000, 20_000]]) {
    const g = financingGrant(f, c, { debt_draw: 1e9, debt_repay: repay, equity_raise: raise }, equityCapacity(f, c));
    const out = play(w, c, "firm_1", { debt_draw: 1e9, equity_raise: raise, debt_repay: repay });
    const drawn = resultOf(out, "firm_1").cash_flow.cf_lines!.financing.debt_draw ?? 0;
    // The books price the issue fee on the advanced investor-trust stock, so allow the fee drift.
    assert.ok(Math.abs(drawn - g.draw) <= 0.01 * g.draw + 1, `raise ${raise} repay ${repay}: engine drew ${drawn}, form says ${g.draw}`);
    assert.equal(g.creditCapacity, creditCapacity(f, c, g.equityNet, g.repay));
  }
  // Equity gone ⇒ nothing to lend against.
  const broke = { ...f }; wipeEquity(broke);
  assert.equal(creditCapacity(broke, c), 0);
});

test("item 6: a cut or refused draw is round news, private to the firm (CREDIT / CREDIT REFUSED)", () => {
  const c = resolveConfig();
  const w = initGame(c);
  const out = play(w, c, "firm_2", { debt_draw: 50_000_000 });
  assert.ok(out.result.events.some((e) => e.startsWith("CREDIT: the bank lends firm_2 only $") && e.includes("$50,000,000")));
  const w2 = initGame(c);
  wipeEquity(firm(w2, "firm_3"));
  const out2 = play(w2, c, "firm_3", { debt_draw: 100_000 });
  assert.ok(out2.result.events.some((e) => e.startsWith("CREDIT REFUSED: the bank lends firm_3 nothing") && /used up its equity/.test(e)));
  assert.ok(!play(initGame(c), c, "firm_4", { debt_draw: 10_000 }).result.events.some((e) => e.startsWith("CREDIT")), "a draw inside the limit is silent");
});

test("item 3: a repayment never takes closing cash below the covenant floor (flag); absent ⇒ capped by debt only", () => {
  const base = preDw083(resolveConfig());
  const legacy = with_(base, { finance: { repay_cash_cap: false } });
  const capped = with_(base, { finance: { repay_cash_cap: true } });
  const w = initGame(base);
  const f = firm(w, "firm_1");
  addDebt(f, 600_000 - f.debt); setCash(f, 90_000); // owes plenty, little cash
  const ask = { debt_repay: 500_000 };
  const L = resultOf(play(w, legacy, "firm_1", ask), "firm_1");
  assert.equal(-(L.cash_flow.cf_lines!.financing.debt_repay ?? 0), 500_000, "legacy repays it all");
  assert.ok(L.balance_sheet.cash < 0, "…and overdraws the firm");
  const outC = play(w, capped, "firm_1", ask);
  const C = resultOf(outC, "firm_1");
  const floor = covenantCashFloor(capped);
  // Interest is priced on the planned balance either way, so cash before the repayment is the same in both runs.
  const before = L.balance_sheet.cash + 500_000;
  assert.ok(Math.abs(C.balance_sheet.cash - Math.min(floor, before)) < 1, `capped closes at the floor (or where it stood, if already under it): ${C.balance_sheet.cash}`);
  assert.ok(Math.abs(C.balance_sheet.debt - (600_000 - -(C.cash_flow.cf_lines!.financing.debt_repay ?? 0))) < 1, "what wasn't repaid stays owed");
  assert.ok(outC.result.events.some((e) => e.startsWith("REPAYMENT CUT: firm_1")));
  // Plenty of cash ⇒ untouched.
  const w2 = initGame(base); addDebt(firm(w2, "firm_1"), 200_000 - firm(w2, "firm_1").debt);
  const out2 = play(w2, capped, "firm_1", { debt_repay: 100_000 });
  assert.equal(-(resultOf(out2, "firm_1").cash_flow.cf_lines!.financing.debt_repay ?? 0), 100_000);
  assert.ok(!out2.result.events.some((e) => e.startsWith("REPAYMENT CUT")));
});

test("item 2: orders that don't fit cash + granted financing are cut (scale trims tanks, block drops them)", () => {
  const base = preDw083(resolveConfig());
  const w = initGame(base);
  const f = firm(w, "firm_5");
  wipeEquity(f); // no equity ⇒ the bank lends nothing
  setCash(f, 232_000);
  const ask = { invest_cap: 830_000, invest_Q: 51_000, debt_draw: 1_055_000 };
  for (const mode of ["scale", "block"] as const) {
    const c = with_(base, { finance: { affordability_guard: { mode } } });
    const g = applyAffordabilityGuard(f, { ...zero("firm_5", w), ...ask }, c, 0);
    assert.equal(g.grant.draw, 0, "the refused loan is not a source");
    const tanks = g.decision.invest_cap;
    if (mode === "scale") assert.ok(Math.abs(tanks - (232_000 - 51_000)) < 1, `scale keeps what fits: ${tanks}`);
    else assert.equal(tanks, 0, "block drops the order whole");
    const out = play(w, c, "firm_5", ask);
    assert.ok(out.result.events.some((e) => e.startsWith("BLOCKED: firm_5") && /the bank lends \$0 of the \$1,055,000 asked/.test(e)));
    assert.ok(Math.abs((resultOf(out, "firm_5").cash_flow.cf_lines!.investing.tanks ?? 0) + tanks) < 1, "the books pay only the trimmed order");
  }
  // A plan that fits is untouched, and a loan that funds a build is no longer refused by the per-item check.
  const c = resolveConfig(deepMerge(modulesOverride(["facilities"]) as never, { finance: { affordability_guard: { mode: "scale" } } } as never) as never);
  const w2 = initGame(c);
  const f2 = firm(w2, "firm_1"); setCash(f2, 100_000);
  const brewpub = c.modules!.facilities!.types.find((t) => t.id === "brewpub")!;
  const out2 = play(w2, c, "firm_1", { build_facilities: [{ type: "brewpub" }], debt_draw: brewpub.base_cost });
  assert.ok(out2.result.events.some((e) => e.startsWith("FACILITY BUILT: firm_1")), "funded by this round's loan ⇒ built");
  assert.ok(!out2.result.events.some((e) => e.startsWith("BLOCKED")));
  const legacyC = preDw083(resolveConfig(modulesOverride(["facilities"])));
  const out3 = play(w2, legacyC, "firm_1", { build_facilities: [{ type: "brewpub" }], debt_draw: brewpub.base_cost });
  assert.ok(out3.result.events.some((e) => e.startsWith("BUILD BLOCKED: firm_1")), "legacy: beginning cash alone decides");
});

test("item 2 (v3 audit): a repayment the bank would re-lend dollar for dollar is not a cut; instrument draws are sources", () => {
  // Reserve off here so the arithmetic is bare; the reserve has its own test (dw084_audit.test.ts).
  const c = with_(resolveConfig(), { finance: { affordability_guard: { mode: "scale", reserve_running_costs: false } } });
  // At the leverage cap every dollar not repaid is a dollar less the bank lends: dropping the repayment frees
  // nothing and only tells the firm its repayment was "dropped" (the first build did exactly that).
  const w = initGame(c);
  const f = firm(w, "firm_1");
  addDebt(f, c.finance.max_leverage * (f.paid_in_capital + f.retained_earnings) - f.debt); // debt = 3× equity ⇒ no room before a repayment
  const g = applyAffordabilityGuard(f, { ...zero("firm_1", w), invest_cap: f.cash + 200_000, debt_draw: 500_000, debt_repay: 50_000 }, c, 0);
  assert.equal(g.decision.debt_repay, 50_000, "the repayment stands");
  assert.ok(Math.abs(g.grant.draw - 50_000) < 1, "…and makes room for exactly that much new debt");
  assert.ok(!g.cuts.some((x) => x.kind === "repay") && g.cuts.some((x) => x.kind === "tanks"), g.cuts.map((x) => x.label).join(", "));
  assert.ok(Math.abs(g.decision.invest_cap - f.cash) < 1, "tanks trimmed to the cash (draw and repayment net to zero)");
  assert.match(g.events[0], /the bank lends \$50,000 of the \$500,000 asked/);
  // Below the cap a repayment is real cash: with room to borrow, trimming it frees a dollar per dollar.
  const w2 = initGame(c);
  const f2 = firm(w2, "firm_2");
  addDebt(f2, 100_000);
  const g2 = applyAffordabilityGuard(f2, { ...zero("firm_2", w2), invest_cap: f2.cash - 20_000, debt_repay: 60_000 }, c, 0);
  assert.ok(Math.abs(g2.decision.debt_repay - 20_000) < 1, `repayment trimmed by the $40k gap: ${g2.decision.debt_repay}`);
  assert.ok(Math.abs(g2.decision.invest_cap - (f2.cash - 20_000)) < 1, "the tank order is untouched");
  // MOD-B08: a convertible note funds the plan — a source, capped as the books cap it (the first build ignored
  // instrument draws and would have cut a tank order the note was about to pay for).
  const cFi = with_(resolveConfig(modulesOverride(["financialInstruments"])), { finance: { affordability_guard: { mode: "scale", reserve_running_costs: false } } });
  const w3 = initGame(cFi);
  const f3 = firm(w3, "firm_3");
  setCash(f3, 100_000);
  const convCap = cFi.modules!.financialInstruments!.convertible.max_equity_fraction * (f3.paid_in_capital + f3.retained_earnings);
  const g3 = applyAffordabilityGuard(f3, { ...zero("firm_3", w3), invest_cap: 100_000 + convCap, draw_convertible: 10 * convCap }, cFi, 0);
  assert.ok(Math.abs(g3.instruments - convCap) < 1, `the note counts at its cap: ${g3.instruments} vs ${convCap}`);
  assert.equal(g3.cuts.length, 0, "a plan the note funds is not cut");
  assert.ok(Math.abs(g3.sources - (100_000 + convCap)) < 1);
});

test("item 4(b): a shortfall inside the overdraft limit closes at 0 cash, as debt, and the firm stays open", () => {
  const base = preDw083(resolveConfig());
  const c = with_(base, { finance: { overdraft: { max_fraction_of_assets: 0.25 } } });
  const w = initGame(c);
  const f = firm(w, "firm_6");
  setCash(f, 20_000); // a bad quarter will push this below zero
  const out = play(w, c, "firm_6", { invest_B: 120_000 });
  const r = resultOf(out, "firm_6");
  assert.equal(r.balance_sheet.cash, 0);
  assert.ok((r.cash_flow.cf_lines!.financing.overdraft ?? 0) > 0);
  assert.equal(r.status, "active", "covered ⇒ not insolvent");
  assert.ok(out.result.events.some((e) => e.startsWith("OVERDRAFT: the bank covers firm_6")));
  const legacy = resultOf(play(w, base, "firm_6", { invest_B: 120_000 }), "firm_6");
  assert.equal(legacy.status, "bankrupt", "legacy: cash ≤ 0 closes at once");
  // Beyond the limit the cash stays negative and the firm closes.
  const w2 = initGame(c); setCash(firm(w2, "firm_6"), 20_000);
  const out2 = play(w2, c, "firm_6", { invest_B: 5_000_000 });
  assert.equal(resultOf(out2, "firm_6").status, "bankrupt");
  assert.ok(out2.result.events.some((e) => e.startsWith("OVERDRAFT EXHAUSTED: firm_6")));
});

test("item 7: a vertical asset the firm can't fund says so (legacy path)", () => {
  const c = preDw083(resolveConfig(modulesOverride(["verticalIntegration"])));
  const w = initGame(c);
  setCash(firm(w, "firm_2"), 50_000);
  const out = play(w, c, "firm_2", { buy_vertical: ["hop_supplier"] });
  assert.ok(out.result.events.some((e) => e.startsWith("PURCHASE FAILED: firm_2 cannot fund the hop & grain supplier")));
});

test("item 5: with phantoms off, a firm that never entered a region takes no share there", () => {
  const base = preDw083(resolveConfig(modulesOverride(["geography"])));
  const decide = (w: WorldState) => w.firms.map((x) => ({ ...zero(x.id, w), ...(x.id === "firm_1" ? { market_presence: { home: 1, heartland: 1 } } : {}) }));
  const legacyOut = resolveRound(initGame(base), decide(initGame(base)), base);
  const fixedC = with_(base, { demand: { phantom_competitors: false } });
  const fixedOut = resolveRound(initGame(fixedC), decide(initGame(fixedC)), fixedC);
  const want = (out: ReturnType<typeof resolveRound>, id: string) => Object.values(resultOf(out, id).segments).reduce((a, s) => a + s.q_desired, 0);
  assert.ok(want(legacyOut, "firm_2") > want(fixedOut, "firm_2") * 1.05, "legacy counted shoppers in a region firm_2 never entered");
  const sold = (out: ReturnType<typeof resolveRound>, id: string) => resultOf(out, id).markets?.heartland?.q_sold ?? 0;
  assert.ok(sold(fixedOut, "firm_1") >= sold(legacyOut, "firm_1"), "the firm that entered gets the region's shoppers");
});

test("running costs: what the form says sales must cover is what a zero-sales round actually charges", async () => {
  const { runningCostEstimate } = await import("../src/index.js");
  for (const mods of [[], ["facilities"], ["facilities", "verticalIntegration", "laborMarket"]] as const) {
    const c = resolveConfig(modulesOverride([...mods] as never));
    const w = initGame(c);
    const f = firm(w, "firm_1");
    addDebt(f, 150_000);
    const nosale: Partial<FirmDecision> = {
      price: Object.fromEntries(w.segments.filter((s) => s.active).map((s) => [s.id, 1e6])),
      invest_cap: 40_000, invest_T_gov: 9_000, debt_draw: 20_000, debt_repay: 5_000,
      ...(mods.includes("facilities" as never) ? { build_facilities: [{ type: "taproom" }] } : {}),
    };
    const out = play(w, c, "firm_1", nosale);
    const r = resultOf(out, "firm_1");
    const ol = r.pnl.opex_lines!;
    const est = runningCostEstimate(f, { ...zero("firm_1", w), ...nosale } as FirmDecision, c, 0, { debtAfter: f.debt + 20_000 - 5_000, rate: r.cost_of_capital.r_debt });
    const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)) + 0.5, `${mods.join("+") || "base"} ${what}: estimate ${a} vs round ${b}`);
    near(est.overhead, ol.overhead ?? 0, "overhead");
    near(est.tank_upkeep, ol.tank_upkeep ?? 0, "tank upkeep");
    near(est.regulatory, ol.regulatory ?? 0, "regulatory");
    near(est.facilities, ol.facilities ?? 0, "facilities");
    near(est.interest, r.pnl.interest, "interest");
  }
});
