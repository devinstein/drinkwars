/**
 * Sprint 2 regression (DW-083) — the real class game (1d532afb, 2026-11-03) replayed through the
 * engine from its stored round-0 state with every stored merged decision. Under the config it was
 * played with (no DW-083 flags) it must reproduce the stored world after every round exactly; with
 * the DW-083 flags on, the closures the findings traced to the engine's rules must behave as fixed.
 *
 * The fixture is STUDENT DATA and is never committed. It lives outside git in
 *   <repo>/.scratch/sprint2/{config.json,decisions.json,world_states.json}
 * (or wherever DW_SPRINT2_FIXTURE points). With no fixture this file SKIPS — it never fails CI.
 * Firms are named by id only here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRound, sanitizeDecision, statementLineGaps, deepMerge, type Config, type FirmDecision, type RoundResult, type WorldState } from "../src/index.js";

const DIR = process.env.DW_SPRINT2_FIXTURE ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".scratch", "sprint2");
const have = ["config.json", "decisions.json", "world_states.json"].every((f) => existsSync(join(DIR, f)));
const skip = have ? false : `no fixture at ${DIR} (student data, kept out of git) — set DW_SPRINT2_FIXTURE`;

interface Fixture { decisions: { round: number; firm_id: string; decision: FirmDecision }[] }
// What the server's standing plan carries for a firm with no decision (lifecycle.ts standingDecision):
// only needed when a flag keeps a firm open past the round it closed in on the day.
const CARRY = ["price", "presence", "run_rate", "market_presence", "market_supply", "invest_cap", "invest_process", "invest_Q", "invest_B", "invest_T_emp", "invest_T_inv", "invest_T_gov"] as const;

function replay(config: Config): { rounds: RoundResult[]; worlds: WorldState[] } {
  const states = JSON.parse(readFileSync(join(DIR, "world_states.json"), "utf8")) as { round: number; state: WorldState }[];
  const D = JSON.parse(readFileSync(join(DIR, "decisions.json"), "utf8")) as Fixture;
  const stored = new Map(D.decisions.map((d) => [`${d.round}:${d.firm_id}`, d.decision]));
  let world = structuredClone(states.find((s) => s.round === 0)!.state);
  const segs = world.segments.map((s) => s.id);
  const last = new Map<string, FirmDecision>();
  const rounds: RoundResult[] = [], worlds: WorldState[] = [];
  const nRounds = Math.max(...D.decisions.map((d) => d.round));
  for (let r = 0; r < nRounds; r++) {
    const list = world.firms.filter((f) => f.status === "active").map((f) => {
      const own = stored.get(`${r}:${f.id}`);
      const prev = last.get(f.id);
      const raw = own ?? (prev ? Object.fromEntries(CARRY.filter((k) => prev[k] !== undefined).map((k) => [k, prev[k]])) : {});
      const d = sanitizeDecision(structuredClone(raw), f.id, segs);
      last.set(f.id, d);
      return d;
    });
    const out = resolveRound(world, list, config);
    rounds.push(out.result);
    worlds.push(out.world);
    world = out.world;
  }
  return { rounds, worlds };
}
const cfgPlayed = (): Config => JSON.parse(readFileSync(join(DIR, "config.json"), "utf8")) as Config;
const statusAfter = (rounds: RoundResult[], firm: string) => {
  const rows = rounds.flatMap((r) => r.firm_results.filter((f) => f.firm_id === firm).map((f) => ({ round: r.round, status: f.status, cash: f.balance_sheet.cash })));
  return rows.at(-1)!;
};

test("Sprint 2 as played: the stored game replays to every stored world, exactly, and every statement adds up", { skip }, () => {
  const states = JSON.parse(readFileSync(join(DIR, "world_states.json"), "utf8")) as { round: number; state: WorldState }[];
  const { rounds, worlds } = replay(cfgPlayed());
  let n = 0;
  const bad: string[] = [];
  rounds.forEach((rr, i) => {
    const want = states.find((s) => s.round === i + 1)!.state;
    for (const fr of rr.firm_results) {
      n++;
      const a = worlds[i].firms.find((f) => f.id === fr.firm_id)!, b = want.firms.find((f) => f.id === fr.firm_id)!;
      for (const k of ["cash", "debt", "cap", "Q", "B", "paid_in_capital", "retained_earnings", "ppe_book"] as const) {
        if (Math.abs(a[k] - b[k]) > 1e-6 * Math.max(1, Math.abs(b[k]))) bad.push(`r${i} ${fr.firm_id} ${k}: ${a[k]} vs stored ${b[k]}`);
      }
      if (a.status !== b.status) bad.push(`r${i} ${fr.firm_id} status ${a.status} vs stored ${b.status}`);
      for (const g of statementLineGaps(fr.pnl, fr.balance_sheet, fr.cash_flow)) bad.push(`r${i} ${fr.firm_id} ${g}`);
    }
  });
  assert.deepEqual(bad, [], "replay == stored history");
  assert.equal(n, 38, "38 firm-rounds");
  const closed = ["firm_5", "firm_1", "firm_2", "firm_4", "firm_3", "firm_7"].map((id) => statusAfter(rounds, id));
  assert.deepEqual(closed.map((x) => [x.round, x.status]), [[1, "bankrupt"], [2, "bankrupt"], [5, "bankrupt"], [5, "bankrupt"], [6, "bankrupt"], [6, "bankrupt"]]);
  // Item 6 rides along with no model change: the three refused / cut draws are now round news.
  const ev = (r: number) => rounds[r].events;
  assert.ok(ev(1).some((e) => e.startsWith("CREDIT REFUSED: the bank lends firm_5 nothing of the $1,055,000")));
  assert.ok(ev(4).some((e) => e.startsWith("CREDIT: the bank lends firm_2 only")));
  assert.ok(ev(5).some((e) => e.startsWith("CREDIT REFUSED: the bank lends firm_2 nothing of the $2,075,000")));
  assert.ok(ev(5).some((e) => e.startsWith("CREDIT REFUSED: the bank lends firm_4 nothing of the $2,000,000")));
});

test("Sprint 2, item 3 on: the round-7 repayment that closed firm_7 at −$377 is cut and the firm stays open", { skip }, () => {
  const { rounds } = replay(deepMerge(cfgPlayed() as never, { finance: { repay_cash_cap: true } } as never) as Config);
  const last = statusAfter(rounds, "firm_7");
  assert.equal(last.round, 6);
  assert.equal(last.status, "active");
  assert.ok(last.cash > 0);
  assert.ok(rounds[6].events.some((e) => e.startsWith("REPAYMENT CUT: firm_7 repays nothing")));
});

test("Sprint 2, item 2 on: the three oversized orders are cut before they are paid for", { skip }, () => {
  for (const mode of ["scale", "block"] as const) {
    const { rounds } = replay(deepMerge(cfgPlayed() as never, { finance: { affordability_guard: { mode } } } as never) as Config);
    const blocked = (r: number, id: string) => rounds[r].events.some((e) => e.startsWith(`BLOCKED: ${id}`));
    assert.ok(blocked(1, "firm_5"), `${mode}: firm_5 r1 tanks`);
    assert.ok(blocked(5, "firm_2"), `${mode}: firm_2 r5 builds`);
    assert.ok(blocked(5, "firm_4"), `${mode}: firm_4 r5 tanks`);
    // The $830k / $2.0M / $1.3M checks never clear: no closure is −$0.8M to −$2.1M any more.
    for (const id of ["firm_5", "firm_2", "firm_4"]) assert.ok(statusAfter(rounds, id).cash > -400_000, `${mode}: ${id} closes far shallower than on the day`);
  }
});

test("Sprint 2, item 5 on: removing phantom competitors changes no closure round", { skip }, () => {
  const { rounds } = replay(deepMerge(cfgPlayed() as never, { demand: { phantom_competitors: false } } as never) as Config);
  const closed = ["firm_5", "firm_1", "firm_2", "firm_4", "firm_3", "firm_7"].map((id) => statusAfter(rounds, id));
  assert.deepEqual(closed.map((x) => [x.round, x.status]), [[1, "bankrupt"], [2, "bankrupt"], [5, "bankrupt"], [5, "bankrupt"], [6, "bankrupt"], [6, "bankrupt"]]);
});

test("Sprint 2 under the v3 rules (DW-084): the same decisions leave three firms open, the leader still first", { skip }, () => {
  const v3 = { demand: { stock_knee: 20, phantom_competitors: false }, finance: { repay_cash_cap: true, affordability_guard: { mode: "scale" }, overdraft: { max_fraction_of_assets: 0.25 } } };
  const end = (o: object) => { const { worlds } = replay(deepMerge(cfgPlayed() as never, o as never) as Config); return worlds.at(-1)!.firms; };
  const open = (fs: WorldState["firms"]) => fs.filter((f) => f.status === "active").map((f) => f.id).sort();
  const fs = end(v3);
  assert.deepEqual(open(fs), ["firm_3", "firm_6", "firm_7"], "the covenant firm, the leader and the firm the repayment closed all finish");
  const cash = (id: string) => fs.find((f) => f.id === id)!.cash;
  assert.ok(cash("firm_6") > cash("firm_7") && cash("firm_7") > cash("firm_3") && cash("firm_3") > 100_000);
  // The knee is what keeps them: the same switches with linear quality/brand leave the leader alone.
  assert.deepEqual(open(end({ ...v3, demand: { phantom_competitors: false } })), ["firm_6"]);
});

test("Sprint 2 under the new-game defaults as shipped (v3 + the bank's cash-flow test from round 3 + the running-cost reserve): three open, the leader first", { skip }, () => {
  const shipped = {
    demand: { stock_knee: 20, phantom_competitors: false },
    finance: {
      repay_cash_cap: true,
      affordability_guard: { mode: "scale", reserve_running_costs: true },
      cash_flow_lending: { ebitda_multiple: 3, trailing_rounds: 4, min_history_rounds: 2 },
      overdraft: { max_fraction_of_assets: 0.25 },
    },
  };
  const { worlds } = replay(deepMerge(cfgPlayed() as never, shipped as never) as Config);
  const fs = worlds.at(-1)!.firms;
  assert.deepEqual(fs.filter((f) => f.status === "active").map((f) => f.id).sort(), ["firm_3", "firm_6", "firm_7"]);
  // 11-05 replay: firm_6 ≈ $2.14M, firm_7 ≈ $555k, firm_3 ≈ $244k (one quarter of books instead: $981k / $780k / $472k).
  const cash = (id: string) => fs.find((f) => f.id === id)!.cash;
  assert.ok(cash("firm_6") > cash("firm_7") && cash("firm_7") > cash("firm_3") && cash("firm_3") > 100_000);
});
