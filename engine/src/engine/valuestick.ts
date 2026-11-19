/**
 * The value stick on screen (11-16; U4's Brandenburger–Stuart stick). Per category, for the last resolved quarter:
 * price and cost from the firm's own books, and the two ends a real firm can only estimate (Devin, 11-16):
 *
 *  - **WTP** differs from shopper to shopper, and no firm observes it. In the logit every shopper values a drink at
 *    V + ε, so one shopper's WTP for it — the most they'd pay rather than not buy in the category — is
 *      WTP = price + (U − U₀)/βp,   U − U₀ = (V − V₀) + (ε − ε₀)  ~  Logistic(V − V₀, 1),
 *    a logistic spread around the typical (median) shopper's  price + (V − V₀)/βp, with the middle half of shoppers
 *    within ± ln 3 / βp. The shoppers who buy are those whose WTP clears the price (and beats the rivals' offers), so
 *    a price above the typical shopper's WTP still sells — to the shoppers who value the drink more. The firm sees WTP
 *    only through market research: the consumer survey's estimate carries the same survey error as its other reads
 *    (`researchEstimate`, key "wtp"). Without the survey, `wtp` is null — the server never sends the true value.
 *  - **WTS** is what suppliers and staff need. Ingredients: the game buys inputs at a market price with no supplier
 *    model, so suppliers' need is estimated from the game's own rule for owning a supplier (vertical integration cuts
 *    unit cost by the upstream asset's `unit_cost_reduction`, ~10%: the margin a supplier keeps). A firm that owns its
 *    supplier keeps that margin, so its suppliers' need is its cost. Staff: the job-market rate for each person's role
 *    and skill (`marketRate`); pay below it and morale falls until they quit.
 *    11-18 (costs.wts): `crew_share` of brewing cost is the crew who brew and pour, and every staff need — crew and
 *    named staff — is the going pay × staffNeedFactor(T_emp): a strong Taproom community lowers it (the firm keeps
 *    morale for less), a run-down one raises it. Without costs.wts the 11-16 rule above, unchanged.
 *  - **Cost** = brewing cost per drink + staff pay spread over the drinks sold (people modules).
 *
 * Pure; solo, the server and the edge function call it the same way. Needs `outside` on the round's cells (recorded
 * from 11-16 on); an older result returns null.
 */
import type { Config, FirmId, FirmRoundResult, FirmState, RoundResult, SegmentId, SegmentResult } from "../types.js";
import { marketRate } from "./employees.js";
import { staffNeedFactor } from "./cost.js";
import { researchEstimate } from "./research.js";

const LN3 = Math.log(3);
export interface ValueStickPart { id: string; label: string; dollars: number }
/** The survey's read of shoppers' WTP for this firm's drink: the typical shopper, and the middle half of shoppers. */
export interface WtpEstimate { typical: number; lo: number; hi: number }
export interface ValueStickRow {
  id: SegmentId | "all";
  sold: number; // drinks sold last quarter
  price: number;
  cost: number; // unitCost + staff
  unitCost: number; // brewing cost per drink
  staff: number; // staff pay per drink sold (0 without a people module)
  staffMarket: number; // the job-market rate for the same staff, per drink
  supplierMargin: number; // the share of brewing cost suppliers keep (0 when the firm owns its supplier)
  /** 11-18: the crew's pay inside brewing cost, per drink (0 without costs.wts); the rest of unitCost is ingredients. */
  crew: number;
  /** 11-18: staff need ÷ the going pay at last quarter's Taproom community (1 without costs.wts). */
  needFactor: number;
  wts: number; // estimated: suppliers' need + (crew + staffMarket) × needFactor
  wtp: WtpEstimate | null; // only with market research
  /** Since the quarter before: price and cost moves (cost split over its build-up drivers). Null on the first quarter. */
  moved: { price: number; cost: number; costParts: ValueStickPart[] } | null;
}
export interface ValueStickView {
  round: number;
  rows: ValueStickRow[];
  all: ValueStickRow | null;
  peopleOn: boolean;
  /** 11-18: the crew / staff-need rule is on (costs.wts), with last quarter's Taproom community level. */
  crewSplit: { share: number; tEmp: number } | null;
  surveyed: boolean; // the WTP estimate is present (research bought)
  /** The firm's quality and brand stocks, last quarter and the one before — what moves WTP. */
  stocks: { quality: [number, number] | null; brand: [number, number] | null };
}
/** The consumer survey's settings and the draw it uses (null ⇒ no market research this round). */
export interface WtpSurvey { seed: number; round: number; sd: number }

const COST_PART: [keyof FirmRoundResult["cost_buildup"], string][] = [
  ["learning", "Experience"], ["process", "Process improvements"], ["quality_premium", "Recipe quality"],
  ["productivity", "Staff productivity"], ["location", "Site costs"], ["supply_share", "Supply pact"], ["shock", "Input prices"],
];

type Cell = { utility: number; attraction: SegmentResult["attraction"]; outside: number; price: number; q_sold: number };
function cellsOf(c: Config, r: FirmRoundResult, seg: SegmentId): Cell[] | null {
  const geo = c.modules?.geography?.enabled && r.markets;
  const raw = geo
    ? Object.values(r.markets ?? {}).map((m) => m.bySeg?.[seg]).filter((x): x is NonNullable<typeof x> => !!x && x.q_sold > 0)
    : [r.segments[seg]].filter((x) => !!x && x.q_sold > 0);
  if (!raw.length) return [];
  if (raw.some((x) => x.outside == null || x.utility == null || !x.attraction)) return null; // recorded from 11-16 on
  return raw.map((x) => ({ utility: x.utility!, attraction: x.attraction!, outside: x.outside!, price: x.price, q_sold: x.q_sold }));
}

/** One city's typical-shopper WTP and spread (1/βp), or null when the price term can't give βp. */
function shopperWtp(x: Cell): { median: number; scale: number } | null {
  if (!(x.price > 0) || !(x.attraction.price < 0)) return null;
  const bp = -x.attraction.price / x.price;
  return { median: x.price + (x.utility - x.outside) / bp, scale: 1 / bp };
}

interface Stick { sold: number; price: number; median: number; scale: number; unitCost: number; staff: number; buildup: FirmRoundResult["cost_buildup"] }
function sticksOf(c: Config, rr: RoundResult, firmId: FirmId): Map<SegmentId | "all", Stick> | null {
  const r = rr.firm_results.find((x) => x.firm_id === firmId);
  if (!r) return null;
  const drinks = Object.values(r.segments).reduce((s, x) => s + (x?.q_sold ?? 0), 0);
  if (!(drinks > 0)) return null;
  const staff = ((r.pnl.opex_lines?.staff ?? 0) + (r.pnl.opex_lines?.key_hires ?? 0)) / drinks;
  const out = new Map<SegmentId | "all", Stick>();
  for (const m of rr.market.filter((x) => x.active)) {
    const cells = cellsOf(c, r, m.segment);
    if (cells == null) return null;
    const ws = cells.map((x) => ({ w: x.q_sold, v: shopperWtp(x), p: x.price })).filter((x) => x.v);
    const sold = ws.reduce((s, x) => s + x.w, 0);
    if (!(sold > 0)) continue;
    const avg = (f: (x: (typeof ws)[number]) => number) => ws.reduce((s, x) => s + f(x) * x.w, 0) / sold;
    out.set(m.segment, { sold, price: avg((x) => x.p), median: avg((x) => x.v!.median), scale: avg((x) => x.v!.scale), unitCost: r.unit_cost, staff, buildup: r.cost_buildup });
  }
  if (!out.size) return null;
  const cats = [...out.values()];
  const sold = cats.reduce((s, x) => s + x.sold, 0);
  const avg = (f: (x: Stick) => number) => cats.reduce((s, x) => s + f(x) * x.sold, 0) / sold;
  out.set("all", { sold, price: avg((x) => x.price), median: avg((x) => x.median), scale: avg((x) => x.scale), unitCost: r.unit_cost, staff, buildup: r.cost_buildup });
  return out;
}

/** Unit cost's change split over its drivers: each factor's share of Δln(cost) (productivity divides). */
function costMoves(now: Stick, prev: Stick): ValueStickPart[] {
  const dCost = now.unitCost - prev.unitCost;
  const ln = (k: keyof Stick["buildup"], b: Stick["buildup"]) => Math.log(Math.max(1e-12, k === "productivity" ? 1 / b[k] : b[k]));
  const dl = Object.fromEntries(COST_PART.map(([k]) => [k, ln(k, now.buildup) - ln(k, prev.buildup)]));
  const dTot = Math.log(Math.max(1e-12, now.unitCost)) - Math.log(Math.max(1e-12, prev.unitCost));
  const parts = COST_PART.map(([k, label]) => ({ id: k as string, label, dollars: Math.abs(dTot) > 1e-9 ? (dCost * dl[k]) / dTot : prev.unitCost * dl[k] }));
  if (Math.abs(now.staff - prev.staff) >= 0.005) parts.push({ id: "staff", label: "Staff pay per drink", dollars: now.staff - prev.staff });
  return parts.filter((p) => Math.abs(p.dollars) >= 0.005);
}

/** The value stick for `firmId` from its last resolved quarter. `firm` = its current state (roster, vertical assets);
 *  `survey` = the consumer survey's settings when the firm bought market research (else WTP stays null). */
export function projectValueStick(
  c: Config, firmId: FirmId, records: { round: number; result: RoundResult }[],
  firm?: Pick<FirmState, "employees" | "key_hires" | "vertical_assets"> | null, survey?: WtpSurvey | null,
): ValueStickView | null {
  const last = records[records.length - 1];
  if (!last) return null;
  const now = sticksOf(c, last.result, firmId);
  if (!now) return null;
  const prevRec = records[records.length - 2];
  const prev = prevRec ? sticksOf(c, prevRec.result, firmId) : null;
  // Staff: the job market's rate for the roster ÷ what it is paid (key hires are paid the set rate).
  const roles = new Map((c.modules?.employees?.roles ?? []).map((x) => [x.id, x]));
  const khPay = (firm?.key_hires ?? []).reduce((s, h) => s + (c.modules?.laborMarket?.roles.find((x) => x.id === h.role)?.salary ?? 0), 0);
  const pay = (firm?.employees ?? []).reduce((s, e) => s + e.salary, 0) + khPay;
  const market = (firm?.employees ?? []).reduce((s, e) => s + marketRate(roles.get(e.role)?.base_salary ?? e.salary, e.skill), 0) + khPay;
  const ratio = pay > 0 ? market / pay : 1;
  // Suppliers: the margin a brewery keeps by owning one (the game's upstream asset), unless this firm already does.
  const upstream = (c.modules?.verticalIntegration?.assets ?? []).filter((a) => a.type === "upstream");
  const ownsSupplier = (firm?.vertical_assets ?? []).some((v) => upstream.some((a) => a.id === v.id));
  const supplierMargin = ownsSupplier ? 0 : Math.max(0, Math.min(0.5, upstream[0]?.unit_cost_reduction ?? 0.1));
  const peopleOn = !!(c.modules?.employees?.enabled || c.modules?.laborMarket?.enabled);
  const lastRes = last.result.firm_results.find((x) => x.firm_id === firmId)!;
  const prevRes = prevRec?.result.firm_results.find((x) => x.firm_id === firmId);
  const wtsCfg = c.costs.wts;
  const crewShare = wtsCfg ? Math.max(0, Math.min(1, wtsCfg.crew_share)) : 0;
  const nf = staffNeedFactor(lastRes.state.T_emp, c);
  const row = (id: SegmentId | "all", s: Stick, sub: number): ValueStickRow => {
    const p = prev?.get(id);
    let wtp: WtpEstimate | null = null;
    if (survey) {
      const typical = researchEstimate({ seed: survey.seed, round: survey.round }, { survey_sd: survey.sd, analyst_sd: 0 }, firmId, "wtp", s.median, sub).est;
      wtp = { typical, lo: typical - LN3 * s.scale, hi: typical + LN3 * s.scale };
    }
    return {
      id, sold: s.sold, price: s.price, unitCost: s.unitCost, staff: s.staff, staffMarket: s.staff * ratio,
      cost: s.unitCost + s.staff, supplierMargin, crew: s.unitCost * crewShare, needFactor: nf,
      // suppliers keep supplierMargin of the whole drink's cost (the engine's vertical-integration cut), out of the ingredients
      wts: wtsCfg
        ? s.unitCost * (1 - crewShare - supplierMargin) + (s.unitCost * crewShare + s.staff * ratio) * nf
        : s.unitCost * (1 - supplierMargin) + s.staff * ratio,
      wtp,
      moved: p ? { price: s.price - p.price, cost: s.unitCost + s.staff - (p.unitCost + p.staff), costParts: costMoves(s, p) } : null,
    };
  };
  const ids = [...now.keys()].filter((id) => id !== "all");
  const rows = ids.map((id, i) => row(id, now.get(id)!, i));
  return {
    round: last.round, rows, all: rows.length > 1 ? row("all", now.get("all")!, 99) : null, peopleOn, surveyed: !!survey,
    crewSplit: wtsCfg ? { share: crewShare, tEmp: lastRes.state.T_emp } : null,
    stocks: {
      quality: prevRes ? [prevRes.state.Q, lastRes.state.Q] : null,
      brand: prevRes ? [prevRes.state.B, lastRes.state.B] : null,
    },
  };
}
