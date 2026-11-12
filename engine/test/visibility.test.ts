/**
 * 11-09 (Devin's review): the Tap Dispatch printed a rival's private "orders cut". One visibility rule
 * (engine/src/engine/visibility.ts) now serves solo, the transport and the edge function. These tests
 * keep it whole: every event the engine source can emit falls under a rule, a full-module game emits
 * nothing unclassified, and the private kinds stay with the firms they name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { ADAPTIVE_LEANS, MODULE_REGISTRY, decideAdaptive, eventAudience, initGame, pactParties, resolveRound, visibleEvents } from "../src/index.js";
import { loadConfig } from "../src/config/load.js";
import type { FirmDecision, WorldState } from "../src/types.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

/** Every string the engine pushes onto an events list, with each `${…}` filled by a firm id —
 *  so a new event kind without a rule fails here, before a player reads it. */
function engineEventSamples(): { file: string; sample: string }[] {
  const out: { file: string; sample: string }[] = [];
  const files = [...readdirSync(path.join(SRC, "engine")).map((f) => path.join(SRC, "engine", f)), path.join(SRC, "index.ts")].filter((f) => f.endsWith(".ts"));
  for (const file of files) {
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const literals = (n: ts.Node, acc: string[]) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) acc.push(n.text);
      else if (ts.isTemplateExpression(n)) acc.push(n.head.text + n.templateSpans.map((s) => "firm_1" + s.literal.text).join(""));
      else if (ts.isConditionalExpression(n)) { literals(n.whenTrue, acc); literals(n.whenFalse, acc); }
      else if (ts.isParenthesizedExpression(n)) literals(n.expression, acc);
      return acc;
    };
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "push" && /events$/.test(n.expression.expression.getText(sf))) {
        for (const a of n.arguments) if (!ts.isSpreadElement(a)) for (const s of literals(a, [])) out.push({ file: path.basename(file), sample: s });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

test("every event the engine source can emit falls under a visibility rule", () => {
  const samples = engineEventSamples();
  assert.ok(samples.length > 60, `found ${samples.length} event literals — the scan has gone blind`);
  const missing = samples.filter((s) => eventAudience(s.sample) === null).map((s) => `${s.file}: ${s.sample.slice(0, 90)}`);
  assert.deepEqual(missing, [], "add a rule to engine/src/engine/visibility.ts for each of these");
});

test("a game with every module emits no unclassified event", () => {
  const modules: Record<string, { enabled: boolean }> = {};
  for (const m of MODULE_REGISTRY) if (m.implemented) modules[m.id] = { enabled: true };
  const unclassified = new Set<string>();
  for (const seed of [11, 29, 47]) {
    const c = loadConfig({ modules, game: { seed } } as never);
    let w: WorldState = initGame(c);
    for (let r = 0; r < c.game.n_rounds; r++) {
      const ds: FirmDecision[] = w.firms.filter((f) => f.status === "active").map((f, i) => decideAdaptive(ADAPTIVE_LEANS[i % ADAPTIVE_LEANS.length], f, w, c));
      const res = resolveRound(w, ds, c);
      for (const e of res.result.events) if (eventAudience(e) === null) unclassified.add(e.slice(0, 100));
      w = res.world;
    }
  }
  assert.deepEqual([...unclassified], []);
});

test("one firm's money news reaches only that firm; public news reaches everyone", () => {
  const events = [
    "BLOCKED: firm_3 cannot pay for its whole plan — $900,000 of spending against $400,000 of cash and financing. Cut: tanks",
    "CREDIT: the bank lends firm_3 only $100,000 of the $500,000 it asked — 3× annual operating cash flow",
    "BUILD BLOCKED: firm_3 can't fund a taproom (needs $250,000)",
    "OUTBID: firm_3 lost Ana Ruiz to a rival — their signing bonus $20,000 beat yours ($5,000)",
    "EXPANSION: firm_3 enters Harbor City",
    "FACILITY BUILT: firm_2 breaks ground on a taproom",
    "SHOCK fired: water (cost_spike, mag 0.30, signaled_noisy)",
  ];
  const rival = visibleEvents(events, "firm_2");
  assert.deepEqual(rival, ["EXPANSION: firm_3 enters Harbor City", "FACILITY BUILT: firm_2 breaks ground on a taproom", "SHOCK fired: water (cost_spike, mag 0.30, signaled_noisy)"]);
  assert.deepEqual(visibleEvents(events, "firm_3"), events, "firm_3 reads its own four notices and all the public news");
  assert.equal(visibleEvents(events, null).length, 3, "an observer reads only public news");
  assert.ok(!visibleEvents(["BLOCKED: firm_31 cannot pay for its whole plan"], "firm_3").length, "firm_3 is not firm_31");
});

test("a renegotiation call reaches the pact's partner; the loyalty tail stays with the firm a hire left", () => {
  const parties = pactParties([{ id: "a_2_0", signatories: ["firm_1", "firm_4"] }]);
  const call = "firm_1 calls to renegotiate formal supply_share (a_2_0)";
  assert.deepEqual(visibleEvents([call], "firm_4", parties), [call]);
  assert.deepEqual(visibleEvents([call], "firm_2", parties), []);
  assert.deepEqual(visibleEvents([call], "firm_4"), [], "no lookup → reads as named");
  const poach = "POACHED: firm_2 lures Ana Ruiz away from firm_5 — took 4 quarters of built-up loyalty (+16% contribution)";
  assert.equal(visibleEvents([poach], "firm_5")[0], poach);
  assert.equal(visibleEvents([poach], "firm_2")[0], "POACHED: firm_2 lures Ana Ruiz away from firm_5");
});
