import { test } from "node:test";
import assert from "node:assert/strict";
import { crowdRead, type CrowdSite } from "../src/lib/crowd.js";

// 11-09 (Devin's review): one rival taproom across town made every far parcel read "Blue ocean",
// though the demand model sets every brewery in a city in front of every shopper there.

const cat = { radius: 5, lambda: 0.6, self_weight: 0.5 };
const rivalTap = (x: number, y: number, district = "downtown"): CrowdSite => ({ x, y, own: false, retail: true, district });

test("one rival far across town never reads Blue ocean", () => {
  const r = crowdRead({ x: 15, y: 15, district: "suburbs" }, [rivalTap(0, 0)], cat, 1);
  assert.equal(r.local, 0, "out of catchment reach: no local crowding");
  assert.equal(r.level, "some");
  assert.match(r.why, /1 rival brewery sells in this city/);
});

test("a city with no rival reads Blue ocean; the engine's kernel and draw match geography.ts", () => {
  assert.equal(crowdRead({ x: 8, y: 8, district: "riverside" }, [], cat, 0).level, "open");
  const r = crowdRead({ x: 0, y: 0, district: "downtown" }, [rivalTap(3, 4)], cat, 1); // distance 5 = radius → kernel 0
  assert.equal(r.local, 0);
  const near = crowdRead({ x: 0, y: 0, district: "downtown" }, [rivalTap(0, 1)], cat, 1); // kernel 0.8
  assert.ok(Math.abs(near.local - 0.8) < 1e-9);
  assert.ok(Math.abs(near.draw - 1 / (1 + 0.6 * 0.8)) < 1e-9, "the site keeps 1/(1+λ·crowd) of its draw");
});

test("two rival retail sites in the district read Crowded; production sites never crowd", () => {
  const two = [rivalTap(0, 0), rivalTap(9, 9)];
  assert.equal(crowdRead({ x: 4, y: 12, district: "downtown" }, two, cat, 2).level, "crowded");
  const brewery: CrowdSite = { x: 1, y: 1, own: false, retail: false, district: "southside" };
  assert.equal(crowdRead({ x: 1, y: 2, district: "southside" }, [brewery], cat, 1).level, "some", "a rival brewery next door draws no foot traffic");
  const prod = crowdRead({ x: 0, y: 1, district: "downtown" }, two, cat, 2, false);
  assert.equal(prod.level, "some", "siting a production site: local crowding doesn't apply");
  assert.match(prod.why, /production site draws no foot traffic/);
});

test("your own sites count at self_weight and alone never read as a rival", () => {
  const own: CrowdSite = { x: 0, y: 1, own: true, retail: true, district: "downtown" };
  const r = crowdRead({ x: 0, y: 0, district: "downtown" }, [own], cat, 0);
  assert.ok(Math.abs(r.local - 0.4) < 1e-9);
  assert.equal(r.level, "some");
  assert.match(r.why, /own sites/);
});
