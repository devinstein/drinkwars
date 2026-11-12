/**
 * The siting read for one parcel (11-09, Devin's review: a lot across town from the only rival read
 * "Blue ocean", though every brewery in a city sells to the same shoppers). Two layers, both the
 * engine's own rules:
 *
 * 1. City-wide. The demand model puts every brewery that sells in a city in front of every shopper
 *    there, near or far. So any rival in the city makes the read at least "Some competition".
 * 2. Local (engine `geography.ts`, `locUtilForMarket`). Retail sites crowd each other: each retail
 *    site within `radius` adds max(0, 1 − distance/radius) — a rival's at full weight, your own at
 *    `self_weight` — and a site keeps 1/(1 + λ·crowd) of its draw. Sites with no retail draw (a
 *    production brewery, a canning line) neither crowd nor get crowded.
 *
 * "Crowded" = local crowd ≥ 0.9 (the site keeps ≤ ~65% of its draw at λ 0.6) or two or more rival
 * retail sites in the same district. "Blue ocean" only when no rival sells in the city at all.
 */
export type CrowdLevel = "open" | "some" | "crowded";
export interface CrowdSite { x: number; y: number; own: boolean; retail: boolean; district: string }
export interface CrowdRead { level: CrowdLevel; label: string; color: string; local: number; draw: number; why: string }
export interface Catchment { radius: number; lambda: number; self_weight: number }

const LOOK: Record<CrowdLevel, { label: string; color: string }> = {
  open: { label: "Blue ocean", color: "var(--color-hop)" },
  some: { label: "Some competition", color: "var(--color-gold)" },
  crowded: { label: "Crowded", color: "var(--color-brick)" },
};
const DEFAULT: Catchment = { radius: 5, lambda: 0.6, self_weight: 0.5 };

/** `rivalsInCity` = rival breweries that sell in this city (sites or shipments); `retailHere` = the
 *  facility being sited draws foot traffic (unknown ⇒ assume it does: the parcel's own read). */
export function crowdRead(at: { x: number; y: number; district: string }, sites: CrowdSite[], cat: Partial<Catchment> | undefined, rivalsInCity: number, retailHere = true): CrowdRead {
  const c = { ...DEFAULT, ...(cat ?? {}) };
  let local = 0;
  if (retailHere) {
    for (const s of sites) {
      if (!s.retail || (s.x === at.x && s.y === at.y)) continue;
      const k = Math.max(0, 1 - Math.hypot(at.x - s.x, at.y - s.y) / c.radius);
      if (k > 0) local += k * (s.own ? c.self_weight : 1);
    }
  }
  const draw = 1 / (1 + c.lambda * local);
  const rivalRetailHere = retailHere ? sites.filter((s) => !s.own && s.retail && s.district === at.district).length : 0;
  const level: CrowdLevel = retailHere && (local >= 0.9 || rivalRetailHere >= 2) ? "crowded" : rivalsInCity > 0 || local >= 0.25 ? "some" : "open";
  const city = rivalsInCity > 0 ? `${rivalsInCity} rival brewer${rivalsInCity === 1 ? "y sells" : "ies sell"} in this city, and every brewery here competes for the same shoppers, near or far.` : "";
  const why =
    level === "crowded"
      ? `${rivalRetailHere >= 2 ? `${rivalRetailHere} rival taprooms and shops in this district` : "Retail sites close by"} split the foot traffic: a shop here keeps about ${Math.round(draw * 100)}% of its draw. ${city}`.trim()
      : level === "some"
        ? city || "Your own sites nearby share this foot traffic."
        : "No rival sells in this city yet.";
  return { level, ...LOOK[level], local, draw, why: retailHere ? why : `${why} A production site draws no foot traffic, so nearby sites don't crowd it.` };
}
