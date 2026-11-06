/**
 * DW-084 · v3 — what next semester plays on: quality and brand with a knee (linear to 20, log above),
 * the DW-083 switches on for new games, and TAM/SAM/SOM market sizing from the round's own results.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { initGame, resolveRound, resolveConfig, stockUtility, projectMarketSizing } from "../src/index.js";
import { modulesOverride } from "../src/config/modules.js";
import { preDw083 } from "./fixtures/legacy.js";
import type { Config, FirmDecision, WorldState } from "../src/types.js";

const zero = (id: string, w: WorldState, over: Partial<FirmDecision> = {}): FirmDecision => ({
  firm_id: id,
  price: Object.fromEntries(w.segments.filter((s) => s.active).map((s) => [s.id, 7])),
  presence: Object.fromEntries(w.segments.filter((s) => s.active).map((s) => [s.id, 1])),
  invest_cap: 0, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0, invest_T_gov: 0,
  debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, agreement_actions: [], exit_action: null, ...over,
});
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

test("new games default to the v3 rules; a stored pre-v3 config (keys absent) still validates", () => {
  const c = resolveConfig();
  assert.equal(c.demand.stock_knee, 20);
  assert.equal(c.demand.phantom_competitors, false);
  assert.deepEqual(c.finance.affordability_guard, { mode: "scale", reserve_running_costs: true });
  assert.deepEqual(c.finance.cash_flow_lending, { ebitda_multiple: 3, trailing_rounds: 4, min_history_rounds: 2 });
  assert.deepEqual(c.finance.overdraft, { max_fraction_of_assets: 0.25 });
  assert.equal(c.finance.repay_cash_cap, true);
  const old = preDw083(resolveConfig());
  assert.equal(old.demand.stock_knee, undefined);
  const w = initGame(old);
  resolveRound(w, w.firms.map((f) => zero(f.id, w)), old); // runs on the legacy rules without complaint
  assert.throws(() => resolveConfig({ demand: { stock_knee: 0 } } as never), /stock_knee must be > 0/);
});

test("the knee: linear to k, k·(1 + ln(x/k)) above — continuous, same slope at k, and absent ⇒ x", () => {
  const c = { demand: { stock_knee: 20 } } as Pick<Config, "demand">;
  assert.equal(stockUtility(15, c), 15);
  assert.equal(stockUtility(20, c), 20);
  assert.ok(near(stockUtility(20 * Math.E, c), 40), "e·k ⇒ 2k");
  const h = 1e-6;
  assert.ok(near((stockUtility(20 + h, c) - stockUtility(20, c)) / h, 1, 1e-4), "slope 1 at the knee");
  assert.ok(near(stockUtility(80, c), 20 * (1 + Math.log(4))));
  assert.equal(stockUtility(80, { demand: {} } as Pick<Config, "demand">), 80, "absent ⇒ linear");
});

test("the knee narrows a funded leader's share; the breakdown applies the same shape (no phantom 'collab')", () => {
  const run = (c: Config) => {
    const w = initGame(c);
    const lead = w.firms[0];
    lead.Q = 81; lead.B = 64; // Sprint 2's leader at R7, against a field at the starting 10
    return resolveRound(w, w.firms.map((f) => zero(f.id, w)), c).result.firm_results;
  };
  const linear = run(preDw083(resolveConfig()));
  const kneeC = preDw083(resolveConfig());
  kneeC.demand.stock_knee = 20;
  const knee = run(kneeC);
  const shareOf = (rs: typeof linear) => rs[0].segments.mass.q_desired / rs.reduce((a, r) => a + r.segments.mass.q_desired, 0);
  assert.ok(shareOf(knee) < shareOf(linear) - 0.05, `leader's first-choice share: knee ${shareOf(knee).toFixed(3)} vs linear ${shareOf(linear).toFixed(3)}`);
  const a = knee[0].segments.mass.attraction;
  const mass = resolveConfig().segments.find((s) => s.id === "mass")!;
  // Stocks move before demand, so read the Q the logit saw off the linear run (its term is β·Q).
  const qSeen = linear[0].segments.mass.attraction.quality / mass.beta_q;
  assert.ok(qSeen > 20, `the leader sits above the knee (Q ${qSeen.toFixed(1)})`);
  assert.ok(near(a.quality, mass.beta_q * stockUtility(qSeen, { demand: { stock_knee: 20 } } as never), 1e-9), "quality term is β·shape(Q)");
  assert.equal(a.agreement, 0, "no alliance ⇒ no 'collab' slice");
  // The rest of the field sits under the knee: identical terms either way.
  assert.ok(near(knee[1].segments.mass.attraction.quality, linear[1].segments.mass.attraction.quality));
});

test("market sizing: TAM ⊇ SAM ⊇ SOM, a market you never entered is outside your SAM, and the gaps add up", () => {
  const c = resolveConfig(modulesOverride(["geography"]));
  const w = initGame(c);
  // firm_1 sells at home and in the Heartland; everyone else stays home.
  const out = resolveRound(w, w.firms.map((f) => zero(f.id, w, f.id === "firm_1" ? { market_presence: { home: 1, heartland: 1 } } : {})), c);
  const label = (id: string) => c.modules!.geography!.markets.find((m) => m.id === id)!.label;
  const s1 = projectMarketSizing(c, "firm_1", out.result, label)!;
  const s2 = projectMarketSizing(c, "firm_2", out.result, label)!;
  const D = out.result.market.filter((m) => m.active).reduce((a, m) => a + m.D, 0);
  for (const s of [s1, s2]) {
    assert.ok(near(s.tam, D, 1e-9), "TAM is the round's addressable demand");
    assert.ok(s.tam >= s.sam && s.sam >= s.som && s.som > 0);
    assert.ok(near(s.som - s.sold, s.turnedAway - s.caught, 1e-9), "picked you − sold = turned away − caught");
    const sumOf = (xs: { turnedAway: number; caught: number; idle: number }[], k: "turnedAway" | "caught" | "idle") => xs.reduce((a, x) => a + x[k], 0);
    assert.ok(near(sumOf(s.cats, "turnedAway"), s.turnedAway) && near(sumOf(s.cats, "caught"), s.caught) && near(sumOf(s.cats, "idle"), s.idle), "categories add up");
    assert.ok(near(sumOf(s.rows, "turnedAway"), s.turnedAway) && near(sumOf(s.rows, "caught"), s.caught) && near(sumOf(s.rows, "idle"), s.idle), "markets add up");
    assert.ok(s.idle >= 0);
    assert.ok(s.rivals >= 0 && s.som + s.rivals <= s.sam + 1e-6, "picked you + picked a rival ≤ the SAM");
  }
  const row = (s: typeof s1, id: string) => s.rows.find((r) => r.id === id)!;
  assert.equal(row(s1, "heartland").youSell, true);
  assert.equal(row(s2, "heartland").youSell, false);
  assert.equal(row(s2, "heartland").poolYours, 0, "a market you never entered is outside your SAM");
  assert.ok(row(s2, "heartland").pool > 0, "…but still in the TAM");
  assert.equal(row(s1, "home").label, label("home"));
  // With phantoms off (v3) a firm's first-choice demand is all inside its SAM.
  const own = out.result.firm_results.find((r) => r.firm_id === "firm_2")!;
  assert.ok(near(s2.som, Object.values(own.segments).reduce((a, x) => a + x.q_desired, 0), 1e-9));
  // Idle = the supply allotted that brewed nothing: every category's cap_alloc − sold, which for a home-only
  // firm is its whole supply less what it sold (the result carries cap_alloc since the v3 audit).
  const alloc = Object.values(own.segments).reduce((a, x) => a + (x.cap_alloc ?? 0), 0);
  assert.ok(alloc > 0, "results carry the allotted supply per category");
  assert.ok(near(s2.idle, Math.max(0, alloc - s2.sold), 1e-6), `idle ${s2.idle} = allotted ${alloc} − sold ${s2.sold}`);
  for (const x of Object.values(own.segments)) assert.ok(x.q_sold <= (x.cap_alloc ?? 0) + 1e-6, "sold never exceeds what was allotted");
});

test("market sizing without geography: one market; a category you don't stock is TAM but not SAM", () => {
  const c = resolveConfig();
  const w = initGame(c);
  const segs = w.segments.filter((s) => s.active).map((s) => s.id);
  const only = segs[0];
  const out = resolveRound(w, w.firms.map((f) => zero(f.id, w, f.id === "firm_3" ? { presence: Object.fromEntries(segs.map((s) => [s, s === only ? 1 : 0])) } : {})), c);
  const s = projectMarketSizing(c, "firm_3", out.result)!;
  assert.equal(s.rows.length, 1);
  const Dof = (id: string) => out.result.market.find((m) => m.segment === id)!.D;
  assert.ok(near(s.tam, segs.reduce((a, id) => a + Dof(id), 0)));
  assert.ok(near(s.sam, Dof(only)), "SAM = the one category stocked");
  assert.equal(projectMarketSizing(c, "firm_3", null), null);
});
