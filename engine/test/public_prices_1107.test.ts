/**
 * 11-07 (Devin): shelf prices are public — information.public_prices puts every rival's last-round price in
 * the categories it sells in on every team's snapshot, research or not; shares, stocks, costs and finances
 * stay behind research. Absent (a stored game) ⇒ prices stay gated, as first built. Plus the Boardroom's
 * structured read: the briefing numbers match the prose they sit beside.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { initGame, resolveRound, resolveConfig, projectFirms, roleBriefings, deepMerge } from "../src/index.js";
import type { Config, FirmDecision, WorldState } from "../src/types.js";

const zero = (id: string, w: WorldState, price = 7): FirmDecision => ({
  firm_id: id,
  price: Object.fromEntries(w.segments.filter((s) => s.active).map((s) => [s.id, price])),
  presence: Object.fromEntries(w.segments.filter((s) => s.active).map((s) => [s.id, 1])),
  invest_cap: 0, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0, invest_T_gov: 0,
  debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, agreement_actions: [], exit_action: null,
});
const play = (c: Config) => {
  const w = initGame(c);
  const out = resolveRound(w, w.firms.map((f, i) => zero(f.id, w, 6.5 + 0.5 * i)), c);
  return { world: out.world, results: out.result.firm_results };
};
const name = (id: string) => id;

test("public prices: a rival's shelf price shows without research; its shares, stocks and finances do not", () => {
  const c = resolveConfig();
  assert.equal(c.information.public_prices, true, "new-game default");
  const { world, results } = play(c);
  const snaps = projectFirms(world, c, "firm_1", results, false, name);
  const rival = snaps.find((f) => f.firm_id === "firm_2")!;
  const r2 = results.find((r) => r.firm_id === "firm_2")!;
  for (const [seg, r] of Object.entries(r2.segments)) if (r.q_sold > 0 || r.share > 0) assert.equal(rival.priceBySeg[seg as never], r.price, `${seg} price is public`);
  assert.deepEqual(rival.shareBySeg, {}, "category shares stay behind research");
  assert.equal(rival.Q, 0); assert.equal(rival.B, 0); assert.equal(rival.cash, 0); assert.equal(rival.unitCost, 0);
  // research still reveals everything
  const bought = projectFirms(world, c, "firm_1", results, true, name).find((f) => f.firm_id === "firm_2")!;
  assert.ok(Object.keys(bought.shareBySeg).length > 0 && bought.Q > 0);
});

test("public prices off (a stored game's config has no flag): prices stay behind research", () => {
  const legacy = deepMerge(resolveConfig() as never, {} as never) as Config;
  delete (legacy.information as { public_prices?: boolean }).public_prices;
  const { world, results } = play(legacy);
  const rival = projectFirms(world, legacy, "firm_1", results, false, name).find((f) => f.firm_id === "firm_2")!;
  assert.deepEqual(rival.priceBySeg, {});
});

test("boardroom data: the numbers match the prose, per role", () => {
  const c = resolveConfig({ modules: { teamRoles: { enabled: true } } } as never);
  const { world } = play(c);
  const b = roleBriefings(world, c, "firm_1");
  assert.deepEqual(b.map((x) => x.data?.role), ["cfo", "cmo", "coo", "ceo"]);
  const cfo = b[0].data!; if (cfo.role !== "cfo") throw new Error("cfo");
  assert.match(b[0].lines[0], new RegExp(`rivals ~${cfo.rivalLeverage.toFixed(2)}× · yours ${cfo.yourLeverage.toFixed(2)}×`));
  const cmo = b[1].data!; if (cmo.role !== "cmo") throw new Error("cmo");
  assert.equal(cmo.nextDemand.length, world.segments.filter((s) => s.active).length);
  const coo = b[2].data!; if (coo.role !== "coo") throw new Error("coo");
  assert.match(b[2].lines[0], new RegExp(`\\$${coo.unitCost.toFixed(2)}`));
  // 11-07 (Devin): the firm's own unit cost is exact — the same number the pricing card shows
  const me = world.firms.find((f) => f.id === "firm_1")!;
  assert.ok(me.unit_cost > 0 && !coo.estimated);
  assert.equal(coo.unitCost, me.unit_cost, "no noise on your own cost");
  const ceo = b[3].data!; if (ceo.role !== "ceo") throw new Error("ceo");
  assert.ok(ceo.watch && ceo.watch !== "firm_1" && b[3].lines[0].includes(ceo.watch));
  assert.deepEqual(roleBriefings(world, c, "firm_1"), b, "deterministic on refresh");
});
