/**
 * 11-07 (Devin): market research is three reports sold as one bundle — retail scan, consumer survey (with an
 * NPS-style score and its trend), analyst brief — at real-world precision. These pin the contract: the reports
 * agree with the dossier, ranges usually hold the truth, finances stay hidden, the score moves the right way.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { initGame, resolveRound, resolveConfig, projectFirms, projectResearch, npsOf, decideAdaptive, ADAPTIVE_LEANS, deepMerge } from "../src/index.js";
import type { Config, RoundResult, WorldState } from "../src/types.js";

const name = (id: string) => id;
const season = (c: Config, rounds: number) => {
  let w = initGame(c);
  const records: { round: number; result: RoundResult }[] = [];
  for (let r = 0; r < rounds; r++) {
    const ds = w.firms.filter((f) => f.status === "active").map((f, i) => decideAdaptive(ADAPTIVE_LEANS[i % ADAPTIVE_LEANS.length], f, w, c));
    const out = resolveRound(w, ds, c);
    records.push({ round: w.round, result: out.result });
    w = out.world;
  }
  return { world: w as WorldState, records };
};

test("research reports: three reports on the last round; null before a round or in a game without them", () => {
  const c = resolveConfig();
  assert.ok(c.information.reports, "new-game default");
  assert.equal(projectResearch([], initGame(c), c, "firm_1", name), null, "nothing before round 1 resolves");
  const { world, records } = season(c, 3);
  const r = projectResearch(records, world, c, "firm_1", name)!;
  assert.equal(r.round, records[2].round);
  assert.deepEqual(r.rounds, records.map((x) => x.round));
  for (const rows of [r.retail, r.survey, r.analyst]) assert.ok(rows.some((x) => x.isYou) && rows.length >= 2);
  assert.deepEqual(projectResearch(records, world, c, "firm_1", name), r, "deterministic: a refresh never moves a number");
  const legacy = deepMerge(c as never, {} as never) as Config;
  delete (legacy.information as { reports?: unknown }).reports;
  assert.equal(projectResearch(records, world, legacy, "firm_1", name), null);
});

test("retail scan: exact sales and shares that sum to the market; sold-out flags; change from the round before", () => {
  const c = resolveConfig();
  const { world, records } = season(c, 3);
  const r = projectResearch(records, world, c, "firm_1", name)!;
  const last = records[2].result.firm_results;
  for (const row of r.retail) {
    const fr = last.find((f) => f.firm_id === row.firm_id)!;
    assert.equal(row.sold, Object.values(fr.segments).reduce((a, s) => a + s.q_sold, 0));
    for (const [seg, x] of Object.entries(row.bySeg)) assert.equal(x.soldOut, fr.segments[seg as never].q_desired - fr.segments[seg as never].q_sold > Math.max(1, 0.02 * fr.segments[seg as never].q_desired));
    assert.ok(row.dShare != null, "a second round gives a change");
  }
  const total = r.retail.reduce((a, x) => a + x.share, 0);
  assert.ok(Math.abs(total - 1) < 1e-9 || total < 1, "shares of drinks sold add to the whole (exited firms aside)");
});

test("survey + analyst: ranges hold the truth about nine times in ten, and their midpoints are the dossier's estimates", () => {
  let inside = 0, n = 0;
  for (const seed of [3, 5, 8, 13, 21, 34]) {
    const c = resolveConfig({ seed } as never);
    const { world, records } = season(c, 2);
    const r = projectResearch(records, world, c, "firm_1", name)!;
    const snaps = projectFirms(world, c, "firm_1", records[1].result.firm_results, true, name);
    for (const f of world.firms.filter((x) => x.status === "active" && x.id !== "firm_1")) {
      const s = r.survey.find((x) => x.firm_id === f.id)!, a = r.analyst.find((x) => x.firm_id === f.id)!, snap = snaps.find((x) => x.firm_id === f.id)!;
      const mid = (x: [number, number]) => (x[0] + x[1]) / 2;
      assert.ok(Math.abs(mid(s.quality) - snap.Q) < 1e-9 && Math.abs(mid(s.brand) - snap.B) < 1e-9 && Math.abs(mid(a.capacity) - snap.cap) < 1e-9, "reports and dossier agree");
      assert.equal(snap.estimated, true);
      for (const [range, truth] of [[s.quality, f.Q], [s.brand, f.B], [a.capacity, f.cap], ...(a.unitCost ? [[a.unitCost, f.unit_cost]] : [])] as [[number, number], number][]) {
        n++; if (truth >= range[0] - 1e-9 && truth <= range[1] + 1e-9) inside++;
      }
    }
  }
  assert.ok(n >= 60 && inside / n > 0.8, `coverage ${inside}/${n}`);
});

test("research hides a rival's cash, debt and profit (a health band instead); your own firm stays exact", () => {
  const c = resolveConfig();
  const { world, records } = season(c, 2);
  const snaps = projectFirms(world, c, "firm_1", records[1].result.firm_results, true, name);
  const rival = snaps.find((x) => x.firm_id === "firm_2")!, you = snaps.find((x) => x.firm_id === "firm_1")!;
  assert.equal(rival.cash, 0); assert.equal(rival.debt, 0); assert.equal(rival.netIncome, 0);
  assert.ok(["strong", "steady", "stretched", "distressed"].includes(rival.health!));
  const me = world.firms.find((f) => f.id === "firm_1")!;
  assert.equal(you.cash, me.cash); assert.equal(you.Q, me.Q); assert.equal(you.estimated, undefined);
});

test("NPS-style score: better value than the field raises it, buyers who only settled for it pull it down, and the survey carries its trend", () => {
  const c = resolveConfig();
  const { world, records } = season(c, 4);
  const res = records[3].result.firm_results;
  const pick = res.find((f) => Object.values(f.segments).some((s) => s.q_desired > 0))!;
  const base = npsOf(res, pick.firm_id)!;
  assert.ok(base >= -100 && base <= 100);
  const bump = (du: number, sold?: (s: { q_desired: number; q_sold: number }) => number) => res.map((f) => f.firm_id !== pick.firm_id ? f : ({ ...f, segments: Object.fromEntries(Object.entries(f.segments).map(([k, s]) => [k, { ...s, utility: s.utility + du, q_sold: sold ? sold(s) : s.q_sold }])) }));
  assert.ok(npsOf(bump(0.5) as never, pick.firm_id)! > base, "more value per drink than the field → higher");
  assert.ok(npsOf(bump(0, (s) => s.q_desired * 1.5) as never, pick.firm_id)! < npsOf(bump(0, (s) => s.q_desired) as never, pick.firm_id)!, "overflow buyers (their first choice sold out) → lukewarm");
  assert.equal(npsOf(bump(0, (s) => s.q_desired * 0.5) as never, pick.firm_id), npsOf(bump(0, (s) => s.q_desired) as never, pick.firm_id), "shoppers turned away aren't customers: sell-outs live in the retail scan");
  const r = projectResearch(records, world, c, "firm_1", name)!;
  for (const s of r.survey) assert.equal(s.npsTrend.length, records.length);
});
