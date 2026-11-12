/**
 * Market research as three reports (11-07, Devin: one bundle, NPS-style score with its trend). Each report sells
 * what a real research firm sells, at the precision it can deliver, so research stays valuable without handing
 * a team its rivals' books:
 *
 *  - Retail scan (store and distributor sales data): each brewery's drinks sold and share by category, which
 *    ones sold out, and the change from the round before. Exact, one round old.
 *  - Consumer survey (a brand-tracking poll): perceived quality and brand as ranges (survey error), each
 *    brewery's first-choice share by category, and an NPS-style recommend score with its trend.
 *  - Analyst brief (industry analysts, credit reports, public hiring): unit cost and capacity as ranges, a
 *    financial-health band instead of cash and debt, headcount and key hires.
 *
 * Never on sale: a rival's decisions this round, its plans, its exact cash, debt or profit, or its staff's
 * loyalty. Estimates are deterministic per (seed, round, brewery, measure), so every team that buys the
 * bundle reads the same report, and a refresh never moves a number. Config: `information.reports`
 * (new-game default; absent ⇒ research reveals exact figures, as first built).
 */
import type { Config, FirmId, FirmRoundResult, FirmState, RoundResult, SegmentId, WorldState } from "../types.js";
import { RNG, deriveSeed } from "../rng.js";

export type Range = [number, number];
export type HealthBand = "strong" | "steady" | "stretched" | "distressed";
export type ResearchKey = "quality" | "brand" | "nps" | "unitCost" | "capacity" | "leverage" | "valuation" | "T_emp" | "T_inv" | "T_gov" | "salary" | "morale";

/** The report settings, or null when the game predates the three reports. */
export const researchReports = (c: Config): { survey_sd: number; analyst_sd: number } | null => c.information?.reports ?? null;

/** Relative error by measure, as a multiple of the survey's or the analyst's base error. */
const SPREAD: Record<ResearchKey, { from: "survey" | "analyst"; k: number }> = {
  quality: { from: "survey", k: 1 }, brand: { from: "survey", k: 1 }, nps: { from: "survey", k: 1 },
  unitCost: { from: "analyst", k: 0.75 }, capacity: { from: "analyst", k: 1 }, leverage: { from: "analyst", k: 2 }, valuation: { from: "analyst", k: 2 },
  T_emp: { from: "analyst", k: 1.5 }, T_inv: { from: "analyst", k: 1.5 }, T_gov: { from: "analyst", k: 1.5 }, salary: { from: "analyst", k: 1 }, morale: { from: "analyst", k: 1 },
};
const KEY_SALT: Record<ResearchKey, number> = { quality: 1, brand: 2, nps: 3, unitCost: 4, capacity: 5, leverage: 6, valuation: 7, T_emp: 8, T_inv: 9, T_gov: 10, salary: 11, morale: 12 };
const firmIndex = (id: FirmId): number => Number(id.replace(/[^0-9]/g, "")) || 0;

/** This measure's relative error (a standard deviation) under these settings. */
export const researchSd = (rep: { survey_sd: number; analyst_sd: number }, key: ResearchKey): number => (SPREAD[key].from === "survey" ? rep.survey_sd : rep.analyst_sd) * SPREAD[key].k;

/** A fixed draw in [-2, 2] standard deviations for (seed, round, brewery, measure, sub-key). */
export function researchDraw(seed: number, round: number, firmId: FirmId, key: ResearchKey, sub = 0): number {
  const rng = new RNG(deriveSeed(seed, round, 7000 + firmIndex(firmId) * 101 + KEY_SALT[key] * 7 + sub * 1009));
  return Math.max(-2, Math.min(2, rng.normal(0, 1)));
}

/** The analyst's or the survey's estimate of a true value (relative error), and the range they publish
 *  around it: ±1.5 standard deviations, so the truth lands inside it about nine times in ten. */
export function researchEstimate(world: Pick<WorldState, "seed" | "round">, rep: { survey_sd: number; analyst_sd: number }, firmId: FirmId, key: ResearchKey, truth: number, sub = 0): { est: number; range: Range } {
  const sd = researchSd(rep, key);
  const est = truth * (1 + sd * researchDraw(world.seed, world.round, firmId, key, sub));
  return { est, range: [est * (1 - 1.5 * sd), est * (1 + 1.5 * sd)] };
}

/**
 * NPS-style recommend score, −100 to +100, for one brewery in one resolved round. Asked of its customers, as a
 * real NPS survey is: buyers who picked it first are promoters or detractors by how its value (the utility
 * shoppers choose by: price, quality, brand and fit) compares with the category's average seller; buyers who
 * settled for it after their first choice sold out lean lukewarm. Shoppers it turned away were never its
 * customers, so sell-outs show in the retail scan, not here (a capacity-bound class market would otherwise
 * read negative for everyone). Average value reads about +27; the bot field runs from about −10 to +65.
 */
export function npsOf(firmResults: FirmRoundResult[], firmId: FirmId): number | null {
  const me = firmResults.find((f) => f.firm_id === firmId);
  if (!me) return null;
  const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
  let num = 0, den = 0;
  for (const [seg, s] of Object.entries(me.segments)) {
    if (!(s.q_sold > 0)) continue;
    const sellers = firmResults.filter((f) => (f.segments[seg as SegmentId]?.q_desired ?? 0) > 0 || (f.segments[seg as SegmentId]?.q_sold ?? 0) > 0);
    const mean = sellers.reduce((a, f) => a + f.segments[seg as SegmentId].utility, 0) / sellers.length;
    const m = s.utility - mean;
    const served = Math.min(s.q_desired, s.q_sold), settled = Math.max(0, s.q_sold - s.q_desired);
    const promoters = clamp(0.45 + 0.35 * m, 0.05, 0.9), detractors = clamp(0.18 - 0.25 * m, 0.02, 0.7);
    num += served * (promoters - detractors) + settled * (0.5 * promoters - Math.min(0.9, detractors + 0.15));
    den += served + settled;
  }
  return den > 0 ? (100 * num) / den : null;
}

/** The survey's reading of the score: the true score plus a few points of sampling error, clamped. */
const npsRead = (seed: number, round: number, rep: { survey_sd: number; analyst_sd: number }, firmId: FirmId, truth: number | null): number | null =>
  truth == null ? null : Math.max(-100, Math.min(100, Math.round(truth + 30 * rep.survey_sd * researchDraw(seed, round, firmId, "nps"))));

/** A credit-report style band from the books the analyst can see: leverage, interest cover, cash. */
export function healthBand(f: FirmState, fr: FirmRoundResult | undefined, c: Config): HealthBand {
  const equity = f.paid_in_capital + f.retained_earnings;
  const lev = equity > 0 ? f.debt / equity : 10;
  const cov = fr?.cost_of_capital.coverage ?? 999;
  const safe = c.scoring.cash_safety_threshold, healthy = c.scoring.healthy_leverage, thr = c.finance.coverage_threshold;
  const below = f.rounds_below_health ?? 0; // the engine's own count of quarters under the health line
  if (below >= 2 || equity <= 0 || f.cash < 0.5 * safe) return "distressed";
  if (below >= 1 || lev > healthy || cov < thr || f.cash < safe) return "stretched";
  if (lev <= 0.5 * healthy && cov >= 3 && f.cash >= 2 * safe) return "strong";
  return "steady";
}

export interface ResearchRetailRow { firm_id: FirmId; name: string; isYou: boolean; sold: number; share: number; dShare: number | null; bySeg: Record<string, { sold: number; share: number; soldOut: boolean; dShare: number | null }>; byMarket?: Record<string, number> }
export interface ResearchSurveyRow { firm_id: FirmId; name: string; isYou: boolean; quality: Range; brand: Range; firstChoice: Record<string, number>; nps: number | null; npsTrend: (number | null)[] }
export interface ResearchAnalystRow { firm_id: FirmId; name: string; isYou: boolean; unitCost: Range | null; capacity: Range; health: HealthBand; headcount: number | null; keyHires: string[] }
/** The bundle a team buys: the three reports on the last resolved round. */
export interface ResearchView { round: number; rounds: number[]; retail: ResearchRetailRow[]; survey: ResearchSurveyRow[]; analyst: ResearchAnalystRow[] }

/** The three reports, from the resolved rounds so far (oldest first) and the world as it stands. Null before a
 *  round has resolved, or in a game made before the reports existed. */
export function projectResearch(records: { round: number; result: RoundResult }[], world: WorldState, c: Config, viewerId: FirmId, nameOf: (id: FirmId) => string): ResearchView | null {
  const rep = researchReports(c);
  const last = records[records.length - 1];
  if (!rep || !last) return null;
  const prev = records.length > 1 ? records[records.length - 2] : null;
  const firms = world.firms.filter((f) => f.status === "active" || f.id === viewerId);
  const res = last.result.firm_results;
  const segShare = (rs: FirmRoundResult[], id: FirmId, seg: string) => {
    const total = rs.reduce((a, f) => a + (f.segments[seg as SegmentId]?.q_sold ?? 0), 0);
    const mine = rs.find((f) => f.firm_id === id)?.segments[seg as SegmentId]?.q_sold ?? 0;
    return total > 0 ? mine / total : 0;
  };
  const allShare = (rs: FirmRoundResult[], id: FirmId) => {
    const total = rs.reduce((a, f) => a + Object.values(f.segments).reduce((b, s) => b + s.q_sold, 0), 0);
    const fr = rs.find((f) => f.firm_id === id);
    return total > 0 && fr ? Object.values(fr.segments).reduce((b, s) => b + s.q_sold, 0) / total : 0;
  };

  const retail: ResearchRetailRow[] = firms.map((f) => {
    const fr = res.find((x) => x.firm_id === f.id);
    const bySeg: ResearchRetailRow["bySeg"] = {};
    for (const [seg, s] of Object.entries(fr?.segments ?? {})) {
      if (!(s.q_desired > 0 || s.q_sold > 0)) continue;
      bySeg[seg] = { sold: s.q_sold, share: segShare(res, f.id, seg), soldOut: s.q_desired - s.q_sold > Math.max(1, 0.02 * s.q_desired), dShare: prev ? segShare(res, f.id, seg) - segShare(prev.result.firm_results, f.id, seg) : null };
    }
    const byMarket = fr?.markets ? Object.fromEntries(Object.entries(fr.markets).filter(([, m]) => m.q_sold > 0).map(([id, m]) => [id, m.q_sold])) : undefined;
    const sold = Object.values(fr?.segments ?? {}).reduce((a, s) => a + s.q_sold, 0);
    return { firm_id: f.id, name: nameOf(f.id), isYou: f.id === viewerId, sold, share: allShare(res, f.id), dShare: prev ? allShare(res, f.id) - allShare(prev.result.firm_results, f.id) : null, bySeg, ...(byMarket && Object.keys(byMarket).length ? { byMarket } : {}) };
  });

  const survey: ResearchSurveyRow[] = firms.map((f) => {
    const fr = res.find((x) => x.firm_id === f.id);
    return {
      firm_id: f.id, name: nameOf(f.id), isYou: f.id === viewerId,
      quality: researchEstimate(world, rep, f.id, "quality", f.Q).range,
      brand: researchEstimate(world, rep, f.id, "brand", f.B).range,
      firstChoice: Object.fromEntries(Object.entries(fr?.segments ?? {}).filter(([, s]) => s.q_desired > 0).map(([seg, s]) => [seg, s.share])),
      nps: npsRead(world.seed, last.round, rep, f.id, npsOf(res, f.id)),
      npsTrend: records.map((r) => npsRead(world.seed, r.round, rep, f.id, npsOf(r.result.firm_results, f.id))),
    };
  });

  const analyst: ResearchAnalystRow[] = firms.map((f) => {
    const fr = res.find((x) => x.firm_id === f.id);
    const you = f.id === viewerId;
    return {
      firm_id: f.id, name: nameOf(f.id), isYou: you,
      unitCost: f.unit_cost > 0 ? (you ? [f.unit_cost, f.unit_cost] : researchEstimate(world, rep, f.id, "unitCost", f.unit_cost).range) : null,
      capacity: you ? [f.cap, f.cap] : researchEstimate(world, rep, f.id, "capacity", f.cap).range,
      health: healthBand(f, fr, c),
      headcount: fr?.state.headcount ?? (f.employees ? f.employees.length : null),
      keyHires: (f.key_hires ?? []).map((h) => h.role),
    };
  });

  return { round: last.round, rounds: records.map((r) => r.round), retail, survey, analyst };
}
