import { test } from "node:test";
import assert from "node:assert/strict";
import { groupDispatch } from "../src/components/eventFeed.js";

// 11-09 (Devin's review): the Tap Dispatch as a hierarchy — same-kind moves fold into one compact line
// ("New markets entered: Switchback + Iron Kettle → Harbor City · Cobblestone → Cedar Falls").

test("market entries fold by destination; builds and hires fold by house", () => {
  const { groups, singles } = groupDispatch([
    "EXPANSION: Switchback Brewing enters coastal",
    "EXPANSION: Iron Kettle Brewing enters coastal",
    "EXPANSION: Cobblestone Brewing enters heartland",
    "FACILITY BUILT: Switchback Brewing breaks ground on a taproom in coastal (online in 1 round)",
    "FACILITY BUILT: Switchback Brewing breaks ground on a canning line (online in 1 round)",
    "HIRE: Hop Theory brings on Hana B., a head brewer",
    "SHOCK fired: water (cost_spike, mag 0.30, signaled_noisy)",
  ], "Hop Theory");
  const entry = groups.find((g) => g.id === "entry")!;
  assert.deepEqual(entry.lines.map((l) => [l.firms, l.text]), [[["Switchback Brewing", "Iron Kettle Brewing"], "→ Harbor City"], [["Cobblestone Brewing"], "→ Cedar Falls"]]);
  const built = groups.find((g) => g.id === "built")!;
  assert.deepEqual(built.lines, [{ firms: ["Switchback Brewing"], text: "taproom in Harbor City, canning line", mine: false }]);
  const hire = groups.find((g) => g.id === "hire")!;
  assert.equal(hire.mine, true, "the reader's own hire flags the group");
  assert.equal(hire.lines[0].text, "Hana B. (head brewer)");
  assert.equal(singles.length, 1, "the shock keeps its own story");
  assert.equal(singles[0].kind, "shock");
});

test("the firm's own notices stay single stories, flagged as its own", () => {
  const { groups, singles } = groupDispatch(["BLOCKED: Hop Theory cannot pay for its whole plan — $900,000 of spending against $400,000 of cash and financing. Cut: tank order $600,000 → $100,000"], "Hop Theory");
  assert.equal(groups.length, 0);
  assert.equal(singles[0].title, "Orders cut");
  assert.equal(singles[0].mine, true);
});

test("11-09 · the kinds that printed raw engine text now read as stories; private ones reach the firm's card", async () => {
  const { parseEvents, roundNews } = await import("../src/components/eventFeed.js");
  const you = "Hop Theory";
  const raw = [
    "BUILD BLOCKED: Hop Theory can't fund a taproom (needs $220,000)",
    "BUILD BLOCKED: Hop Theory is at its facility cap (6) — canning line not built",
    "BUILD BLOCKED: Hop Theory — that parcel is already taken",
    "POACH REBUFFED: Ana Ruiz spurns Hop Theory and stays with Iron Kettle",
    "PARCEL WON: Iron Kettle wins a contested parcel in coastal ($15,000 premium)",
    "EXIT→INVEST: Iron Kettle buys 12.5% of Hop Theory at V=$1,200,000",
    "EXIT→INVEST failed (no valid target); Iron Kettle banked $340,000",
    "HIRE FAILED: Hop Theory cannot cover a head brewer's $45,000 signing bonus + first salary",
  ];
  for (const e of parseEvents(raw, you)) {
    assert.ok(e.title && !/^[A-Z →]+:/.test(String(e.body)), `${e.title}: ${String(e.body)}`);
    assert.doesNotMatch(String(e.body), /\byou (runs|has|is)\b/i, "second-person grammar");
  }
  assert.deepEqual(roundNews(raw, you).firm.map((e) => e.title), ["Build blocked", "Build blocked", "Build blocked", "Hire fell through"]);
});
