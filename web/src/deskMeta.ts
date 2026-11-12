/**
 * Teams-mode L1 — the desk cockpit content model (DW-031).
 *
 * A "cockpit" is the per-role experience layered above the desk-filtered DecisionForm:
 * each C-suite seat should feel native to the sub-discipline a student walks in with
 * (Finance → CFO, Marketing → CMO, Ops/People → COO, Strategy/Gov → Corp-Dev, GM → CEO).
 *
 * This file is PURE: personas (static) + metric selectors that read `GameView` and return
 * display-ready signals/metrics. No engine change — every number comes from data the engine
 * already emits (`view.ownResult`, `view.firms`, `view.own`). Keyed to the FOCUSED DESK (the
 * thing that actually filters the levers), because the shipped partition is 4 desks while the
 * C-suite is 5 roles (CHRO shares the ops desk; the relations desk = corporate-dev/external).
 * `seatRole` drives the "you hold this seat" framing in the UI, not the persona selection.
 */
import type { GameView, FirmSnapshot } from "./game/controller.js";
import { creditLimits, creditReason, equityCapacity, overdraftLimit } from "drinkwars-engine";
import { fmt, SEG_TAG } from "./labels.js";
import { listOf, readSellOuts, roomNote, tankFit, type SellOutRead } from "./lib/sizing.js";
import { tankOutlook } from "./lib/tanks.js";

export type CockpitDesk = "all" | "commercial" | "operations" | "people" | "finance" | "strategy";
export type Tone = "good" | "watch" | "risk" | "neutral";

export interface CockpitPersona {
  desk: CockpitDesk;
  title: string; // "Chief Financial Officer"
  short: string; // "CFO"
  discipline: string; // the concentration a student brings
  charter: string; // one-line mandate
  accent: string; // css var, matches the desk filter chip
  briefingRole?: "cfo" | "cmo" | "coo" | "ceo"; // MOD-B05 intel to surface, if any
}

/** A "your mandate this round" callout: what to watch / your job, with a plain read. */
/** `rows` (11-07 readability pass): the numbers behind the value as label → value lines, so `read` can stay one short line. */
export interface Signal { label: string; value: string; tone: Tone; read: string; rows?: { k: string; v: string; tone?: Tone }[] }
/** A teaching-facing metric: firm value vs the field, with a "what this means" hint. */
export interface Metric { label: string; value: string; field?: string; tone: Tone; hint: string }

export const PERSONAS: Record<CockpitDesk, CockpitPersona> = {
  all: {
    desk: "all", title: "Founder · Whole firm", short: "GM", discipline: "General management",
    charter: "You run every desk. Make one plan where the parts fit together, then submit it.",
    accent: "var(--color-inksoft)", briefingRole: "ceo",
  },
  commercial: {
    desk: "commercial", title: "Chief Marketing Officer", short: "CMO", discipline: "Marketing · Consumer behavior",
    charter: "Prices, brand, and which categories you sell in.",
    accent: "var(--color-copper)", briefingRole: "cmo",
  },
  operations: {
    desk: "operations", title: "Chief Operating Officer", short: "COO", discipline: "Operations · Supply chain",
    charter: "Tanks, brewing operations, recipe quality and sites.",
    accent: "var(--color-aero)", briefingRole: "coo",
  },
  people: {
    desk: "people", title: "Chief People Officer", short: "CHRO", discipline: "People · Org behavior · Sustainability",
    charter: "Hiring, pay and morale: the people who brew and sell.",
    accent: "var(--color-gold)",
  },
  finance: {
    desk: "finance", title: "Chief Financial Officer", short: "CFO", discipline: "Finance · Accounting",
    charter: "Cash, loans, investors and dividends.",
    accent: "var(--color-hop)", briefingRole: "cfo",
  },
  strategy: {
    desk: "strategy", title: "Chief Executive · Strategy", short: "CEO", discipline: "Strategy · Business & government",
    charter: "Deals with rivals, lobbying, buying or selling firms, and whether to exit.",
    accent: "var(--color-plum)", briefingRole: "ceo",
  },
};

// ── field-benchmark helpers ────────────────────────────────────────────────
const active = (view: GameView): FirmSnapshot[] => view.firms.filter((f) => f.status === "active");
const rivals = (view: GameView): FirmSnapshot[] => active(view).filter((f) => !f.isYou);
const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** Field median of a rival metric (empty field → 0). */
const fieldMed = (view: GameView, pick: (f: FirmSnapshot) => number): number => median(rivals(view).map(pick));
/** DW-080: rivals' private numbers (cost, brand, stocks, leverage, capacity, segment shares, roster,
 *  valuation) reach a team only with market research — without it they arrive as 0. That is
 *  "unknown", not "zero": every comparison says "—" and grades nothing (it read "field $0",
 *  "leader 0%", "You lead this segment"). A revealed active rival always has capacity. */
const fieldSeen = (view: GameView): boolean => rivals(view).some((f) => f.cap > 0);
const HIDDEN = "Rivals' numbers show only with market research.";
/** The scorecard's four parts as students see them (scoring-layer spec §8): engine keys stay generic. */
const SCORE_PART: Record<string, string> = { financial: "financial", market: "market", intangible: "preparedness", stakeholder: "standing" };
/** "field X" when the field is visible, else "field —". */
const fieldOf = (view: GameView, show: () => string, word = "field"): string => (fieldSeen(view) ? `${word} ${show()}` : `${word} —`);
/** cmpTone, or neutral when the field is hidden. */
const vsField = (view: GameView, v: number, pick: (f: FirmSnapshot) => number, higherBetter: boolean, band?: number): Tone =>
  fieldSeen(view) ? cmpTone(v, fieldMed(view, pick), higherBetter, band) : "neutral";
/** Utilization of the round just resolved: its sales over the capacity it brewed against — not this
 *  round's (already re-built / worn) capacity, which read 114%. */
const utilization = (view: GameView, sold: number): number => {
  const cap = (view.ownResult as { effective_cap?: number } | null | undefined)?.effective_cap ?? view.own.cap;
  return cap > 0 ? sold / cap : 0;
};
/** Tone from a value vs a benchmark, `higherBetter` flips the sense. `band` = the "watch" gap. */
const cmpTone = (v: number, bench: number, higherBetter: boolean, band = 0.1): Tone => {
  if (!isFinite(v) || bench === 0) return "neutral";
  const rel = (v - bench) / Math.abs(bench);
  const good = higherBetter ? rel > band : rel < -band;
  const bad = higherBetter ? rel < -band : rel > band;
  return good ? "good" : bad ? "risk" : "watch";
};

/** Total units sold / desired this round (0 pre-resolution). */
function volumes(view: GameView): { sold: number; desired: number } {
  const r = view.ownResult;
  if (!r) return { sold: 0, desired: 0 };
  let sold = 0, desired = 0;
  for (const s of Object.values(r.segments)) { sold += s.q_sold; desired += s.q_desired; }
  return { sold, desired };
}

/** DW-084: what the round can be funded with — cash, then the bank's, the investors' and the overdraft's
 *  limits from the engine's own functions on the state the round will price. Sprint 2's teams planned past
 *  all three without ever seeing them. Shown to the CFO and to the founder/CEO desk. (DW-083: the old
 *  "Funding the round" card's `cash < 300` was a $k-era threshold that never fired once money became dollars.) */
function cashToWorkWith(view: GameView): Signal {
  const fin = view.finance;
  const lim = fin ? creditLimits(view.own, { finance: fin }) : null;
  const inv = fin ? equityCapacity(view.own, { finance: fin }) : Infinity;
  const od = fin ? overdraftLimit(view.own, { finance: fin }) : 0;
  const equity = view.own.paid_in_capital + view.own.retained_earnings;
  const rows: NonNullable<Signal["rows"]> = [];
  if (lim != null) rows.push(lim.capacity >= 0.5 ? { k: "Bank lends up to", v: fmt.money(lim.capacity) } : { k: "Bank won't lend", v: creditReason(lim, equity, { finance: fin! }, "your"), tone: "risk" });
  if (Number.isFinite(inv)) rows.push(inv >= 0.5 ? { k: "Investors put in up to", v: fmt.money(inv) } : { k: "Investors won't invest", v: "the firm is valued at $0", tone: "risk" });
  if (od > 0) rows.push({ k: "Emergency overdraft up to", v: `${fmt.money(od)} · at a penalty rate` });
  return { label: "Cash to work with", value: fmt.money(view.own.cash), tone: view.own.cash < (view.scoring?.cash_safety_threshold ?? 120_000) ? "risk" : "neutral", rows,
    read: `Building, hiring and marketing all spend from this.${od > 0 ? " If spending runs past the emergency overdraft, the firm closes." : ""}` };
}

// ── the mandate ("your job this round") ────────────────────────────────────
export function cockpitSignals(desk: CockpitDesk, view: GameView): Signal[] {
  const r = view.ownResult;
  const out: Signal[] = [];
  const round = Math.min(view.round + 1, view.nRounds);

  if (desk === "finance") {
    if (r) {
      const { coverage, leverage, credit_rationed } = r.cost_of_capital;
      const covTone: Tone = coverage >= 3 ? "good" : coverage >= 1.5 ? "watch" : "risk";
      out.push({ label: "Interest coverage", value: `${coverage.toFixed(1)}×`, tone: covTone,
        read: covTone === "risk" ? "Operating profit covers interest less than 1.5 times, so the bank charges a penalty rate, and the rate rises as coverage falls." : covTone === "watch" ? "Operating profit ÷ interest. Below 1.5×, the bank charges a penalty rate." : "Operating profit ÷ interest. Profit covers the interest with room to spare." });
      const levMed = fieldMed(view, (f) => f.leverage);
      out.push({ label: "Leverage vs field", value: `${leverage.toFixed(2)}×`, tone: vsField(view, leverage, (f) => f.leverage, false, 0.2),
        rows: fieldSeen(view) ? [{ k: "Field", v: `≈${levMed.toFixed(2)}×` }] : undefined,
        read: !fieldSeen(view) ? HIDDEN : leverage > levMed * 1.2 ? "More debt per dollar of equity than most rivals, so borrowing costs more." : "Less debt per dollar of equity than most rivals." });
      if (credit_rationed) {
        // The engine sets this flag for a covenant breach (the bank REPRICES bank debt at the penalty spread;
        // the leverage cap itself doesn't move) and for a draw it cut (debt may not pass max_leverage × equity).
        // The old read, "lenders are capping new debt", sat beside "the bank lends up to $1.8M" on the card
        // below it. Say which it is, from the engine's own numbers.
        const fin = view.finance;
        const limNow = fin ? creditLimits(view.own, { finance: fin }) : null;
        const capNow = limNow ? limNow.capacity : null;
        const equity = view.own.paid_in_capital + view.own.retained_earnings;
        const why = limNow && fin ? creditReason(limNow, equity, { finance: fin }, "your") : "within the bank's limits";
        const thr = fin?.coverage_threshold ?? 1.5;
        const lends = capNow != null ? `up to ${fmt.money(capNow)}` : "up to its limits";
        if (capNow != null && capNow < 1) out.push({ label: "Credit", value: "Refused", tone: "risk",
          read: `The bank won't lend this quarter: ${why}.` });
        else if (coverage < thr) out.push({ label: "Credit", value: "Penalty rate", tone: "risk",
          read: `Interest coverage fell below the bank's ${thr}× minimum, so all bank debt now pays a penalty rate. The bank still lends ${lends} (${why}).` });
        else out.push({ label: "Credit", value: "Capped", tone: "risk",
          read: `Last quarter's loan was cut (${why}). This quarter it lends ${lends}.` });
      }
    }
    out.push(cashToWorkWith(view)); // cross-desk handoff: what the round can be funded with (DW-084)
  }

  if (desk === "operations") {
    const { sold, desired } = volumes(view);
    if (r && view.own.cap > 0) {
      const util = utilization(view, sold);
      const utilTone: Tone = util >= 0.95 ? "watch" : util >= 0.7 ? "good" : "risk";
      // 11-06 playtest: "near the ceiling — a build needs CFO cash" sat above "Tanks ahead of demand 45%" — last
      // quarter's ceiling, with a tank order landing now that already covers that demand.
      const outlook = view.capacity ? tankOutlook(view.own, view.capacity, 0) : null;
      const coveredNow = !!(outlook && view.sizing && outlook.landNow >= 0.5 && tankFit(view.sizing, outlook.capThis).covers);
      out.push({ label: "Capacity utilization", value: fmt.pct(util), tone: utilTone,
        read: util >= 0.95 && coveredNow ? `Every tank was busy last quarter. The ${fmt.int(outlook!.landNow)} units you ordered arrive this quarter and cover that demand.` :
          util >= 0.95 ? "Every tank was busy, so some buyers went elsewhere. New tanks take a round to arrive." : util < 0.7 ? "Over 30% of your tanks stood idle, and idle tanks still cost upkeep." : "Most tanks were busy, with a little room to spare." });
      // DW-083/084: only shoppers who picked YOU, in markets you SELL in, and found you SOLD OUT argue for
      // tanks — and only when it's material. The card used to fire on desired − sold alone: 31 of 38
      // firm-rounds in Sprint 2, on shoppers in regions a firm had never entered and on firms with half
      // their tanks idle, and it told every one of them to build. The sizing (TAM/SAM/SOM) keeps the count
      // inside the firm's own markets; without it (an older server) only a single-market game can be read.
      const sz = view.sizing;
      const so = sz ? readSellOuts(sz) : null;
      const turned = so ? so.turned : view.modules?.geography?.enabled ? 0 : Math.max(0, desired - sold);
      const floor = Math.max(0.1 * sold, 1_000);
      // Tanks already on order land before any new ones could: say so, or the card asks for tanks a firm just bought.
      const landing = view.capacity ? tankOutlook(view.own, view.capacity, 0).landNow : 0;
      const capacityCase = (n: number, where: string[], shifted = 0) => out.push({ label: "Turned away", value: fmt.int(n), tone: "risk",
        read: `${fmt.int(n)} shoppers picked you first${where.length ? ` in ${listOf(where)}` : ""} and found you sold out${shifted >= 0.5 ? `, even counting the ${fmt.int(shifted)} units you had spare elsewhere` : ""}. Two levers: a higher price sells fewer drinks at a better margin, and more tanks serve more buyers. New tanks arrive next quarter and need cash from the CFO.${landing >= 0.5 ? ` The ${fmt.int(landing)} units you ordered earlier arrive this quarter first.` : ""}` });
      // The sizing carries the room the firm had (idle tanks + sales to rivals' overflow), so the read doesn't
      // need the utilization gate: a firm that sold out in Lagers with half its tanks idle in Craft has an
      // allocation problem whatever its utilization says — and the old gate said nothing to it at 52%.
      const wrongPlace = (x: SellOutRead) => out.push({ label: "Capacity in the wrong place", value: fmt.int(x.turned), tone: "watch",
        read: `You turned away ${fmt.int(x.turned)} shoppers who picked you${x.short.length ? ` in ${listOf(x.short)}` : ""}, while ${x.spare.length ? `${listOf(x.spare)} had room: ` : ""}${roomNote(x, fmt.int)}. Moving that capacity toward ${x.short.length ? listOf(x.short) : "where you sold out"} would serve ${x.net >= 0.5 ? `about ${fmt.int(Math.min(x.shiftable, x.turned))} of them` : "them"} without new tanks.` });
      // 11-06 playtest: last quarter's demand against THIS quarter's tanks (earlier orders land first). A firm whose
      // landing order already covers its sell-out isn't asked for more; one brewing on far more than it sells hears it
      // before the next order, not after its utilization halves.
      const capThis = view.capacity ? tankOutlook(view.own, view.capacity, 0).capThis : view.own.cap;
      const fit = sz ? tankFit(sz, capThis) : null;
      if (turned >= floor) {
        if (!so) { if (util >= 0.95) capacityCase(turned, []); } // an older server: no sizing, single-market games only (see `turned`)
        else if (so.shiftable >= 0.5 * turned) wrongPlace(so); // moving capacity closes at least half: an allocation problem first
        else if (fit?.covers && landing >= 0.5) out.push({ label: "Turned away", value: fmt.int(so.turned), tone: "watch",
          read: `${fmt.int(so.turned)} shoppers picked you first${so.short.length ? ` in ${listOf(so.short)}` : ""} and found you sold out. The ${fmt.int(landing)} units you ordered earlier arrive this quarter: you can brew ${fmt.int(capThis)} drinks against the ${fmt.int(fit.demand)} shoppers wanted from you, so that demand is covered. A higher price is the other lever: it sells fewer drinks at a better margin.` });
        else capacityCase(so.net, so.short, Math.min(so.shiftable, turned)); // the rest is a capacity (or price) problem
      }
      if (fit?.ample) out.push({ label: "Tanks ahead of demand", value: fmt.pct(fit.util), tone: "risk",
        read: `This quarter you can brew ${fmt.int(capThis)} drinks. If demand matches last quarter's ${fmt.int(fit.demand)}, your tanks run at ${fmt.pct(fit.util)}. Each idle unit still costs ${fmt.price(view.capacity?.fixed_cost_per_unit ?? 0)} a quarter in upkeep, so a smaller tank order saves money unless demand grows.` });
    }
    const ucMed = fieldMed(view, (f) => f.unitCost);
    out.push({ label: "Unit cost vs field", value: fmt.price(view.own.unit_cost), tone: vsField(view, view.own.unit_cost, (f) => f.unitCost, false, 0.08),
      rows: fieldSeen(view) ? [{ k: "Field", v: `≈${fmt.price(ucMed)}` }] : undefined,
      read: `${fieldSeen(view) ? "" : `${HIDDEN} `}Falls as your lifetime brewing grows and as you invest in operations. Crew morale moves productivity.` });
    if (view.inventoryEnabled && r?.inventory) out.push({ label: "Inventory turnover", value: `${r.inventory.turnover.toFixed(1)}×`, tone: r.inventory.turnover < 1 ? "watch" : "good", read: "Drinks sold ÷ average stock on hand. Low turnover means cash sits in kegs, and kegs spoil." });
  }

  if (desk === "commercial") {
    const you = view.firms.find((f) => f.isYou);
    const segs = view.segments.filter((s) => s.active);
    // headline segment = where you have the most share to win/defend
    const primary = segs.map((s) => ({ id: s.id, mine: you?.shareBySeg?.[s.id] ?? 0, lead: Math.max(0, ...rivals(view).map((f) => f.shareBySeg?.[s.id] ?? 0)) }))
      .sort((a, b) => (b.mine + b.lead) - (a.mine + a.lead))[0];
    if (primary && !fieldSeen(view)) {
      out.push({ label: `${SEG_TAG[primary.id] ?? primary.id} share`, value: fmt.pct(primary.mine), tone: "neutral", read: HIDDEN });
    } else if (primary) {
      const behind = primary.lead > primary.mine;
      out.push({ label: `${SEG_TAG[primary.id] ?? primary.id} share`, value: fmt.pct(primary.mine), tone: behind ? "watch" : "good",
        rows: [{ k: "Leader", v: fmt.pct(primary.lead) }],
        read: behind ? "A rival sells more of this category than you." : "You sell more of this category than any rival." });
    }
    const bMed = fieldMed(view, (f) => f.B);
    out.push({ label: "Brand vs field", value: view.own.B.toFixed(0), tone: vsField(view, view.own.B, (f) => f.B, true, 0.1),
      rows: fieldSeen(view) ? [{ k: "Field", v: `≈${bMed.toFixed(0)}` }] : undefined,
      read: `${fieldSeen(view) ? "" : `${HIDDEN} `}Brand builds over rounds and fades without spending. One big round can't buy it.` });
    if (r?.distinctiveness) out.push({ label: "Distinctiveness", value: r.distinctiveness.nearest_neighbor.toFixed(2), tone: "neutral",
      read: "How different your strategy is from your closest rival's: price, size, category mix, quality, brand, relationships and debt. Small means shoppers see you as close substitutes." });
    const { sold, desired } = volumes(view);
    if (desired > sold * 1.05) out.push({ label: "Demand vs supply", value: "capacity-bound", tone: "watch", read: "You sold everything you brewed. More demand only helps with more tanks." });
    if (view.own.pr_cooldown_until != null && view.own.pr_cooldown_until > view.round) out.push({ label: "PR play", value: `ready ~r${view.own.pr_cooldown_until + 1}`, tone: "neutral", read: `Used recently. The next one can run in round ${view.own.pr_cooldown_until + 1}.` });
    else out.push({ label: "PR play", value: "ready", tone: "good", read: "Ready. A PR play gives a short burst of brand buzz." });
  }

  if (desk === "people") {
    const empMed = fieldMed(view, (f) => f.T_emp);
    out.push({ label: "Employee relations", value: view.own.T_emp.toFixed(0), tone: vsField(view, view.own.T_emp, (f) => f.T_emp, true, 0.15),
      rows: fieldSeen(view) ? [{ k: "Field", v: `≈${empMed.toFixed(0)}` }] : undefined,
      read: `${fieldSeen(view) ? "" : `${HIDDEN} `}Higher morale raises productivity, which lowers unit cost.` });
    const you = view.firms.find((f) => f.isYou);
    const roster = you?.employees ?? [];
    if (roster.length) {
      const avgSat = roster.reduce((a, e) => a + e.satisfaction, 0) / roster.length;
      const atRisk = roster.filter((e) => e.satisfaction < 0.45).length;
      out.push({ label: "Crew satisfaction", value: fmt.pct(avgSat), tone: avgSat < 0.45 ? "risk" : avgSat < 0.6 ? "watch" : "good",
        read: atRisk > 0 ? `${atRisk} unhappy enough for a rival to hire away.` : "Content. A rival would have to pay more to hire them away." });
    } else {
      out.push({ label: "Headcount", value: "0", tone: "watch", read: "No named staff yet." });
    }
    out.push({ label: "Poach exposure", value: roster.length ? "watch the market" : "—", tone: "neutral", read: "Rivals can hire your people, and you can hire theirs. Raises and morale keep people from leaving." });
  }

  if (desk === "strategy") {
    const govMed = fieldMed(view, (f) => f.T_gov);
    out.push({ label: "Regulator standing", value: view.own.T_gov.toFixed(0), tone: vsField(view, view.own.T_gov, (f) => f.T_gov, true, 0.15),
      rows: fieldSeen(view) ? [{ k: "Field", v: `≈${govMed.toFixed(0)}` }] : undefined,
      read: `${fieldSeen(view) ? "" : `${HIDDEN} `}Good standing with regulators lowers the chance of fines and adds weight to your lobbying.` });
    if (view.agreements.length) out.push({ label: "Active pacts", value: String(view.agreements.length), tone: "neutral", read: "Partners can walk away. Contract clauses and reputation hold a pact together." });
    if (view.lobbyInitiatives.length) out.push({ label: "Regulation in play", value: String(view.lobbyInitiatives.length), tone: "watch", read: "A proposed rule is gathering support. You can push it, oppose it, or stay out." });
    const wounded = rivals(view).filter((f) => f.distressRounds > 0).length;
    if (wounded > 0) out.push({ label: "M&A openings", value: `${wounded} distressed`, tone: "neutral", read: "A rival in financial trouble can be bought, along with its tanks and customers." });
  }

  if (desk === "all") {
    const myRank = view.standings.findIndex((s) => s.isYou) + 1;
    out.push({ label: "Standing", value: myRank > 0 ? `#${myRank} of ${view.standings.length}` : "—", tone: myRank === 1 ? "good" : myRank > 0 && myRank <= view.standings.length / 2 ? "watch" : "neutral",
      read: "Your score counts the whole season, not just the final round." });
    if (r) {
      const sc = r.scorecard_norm;
      const weakest = (Object.entries(sc) as [string, number][]).sort((a, b) => a[1] - b[1])[0];
      out.push({ label: "Weakest score part", value: `${SCORE_PART[weakest[0]] ?? weakest[0]} (${weakest[1].toFixed(2)})`, tone: weakest[1] < 0 ? "risk" : "watch",
        read: "Your score has four parts: financial, market, preparedness and standing. This one is your lowest, measured against the field." });
    }
    out.push({ label: "This round", value: `R${round}/${view.nRounds}`, tone: "neutral", read: "Read each officer's numbers below, then decide where the money goes." });
    out.push(cashToWorkWith(view)); // DW-084: whoever commits the plan sees what it can be funded with
  }

  // MOD-B05 role intel — a briefing line, when the module is on
  const brief = PERSONAS[desk].briefingRole && view.briefings.find((b) => b.role === PERSONAS[desk].briefingRole);
  if (brief && brief.lines.length) out.push({ label: "Intel", value: brief.title.replace(/ briefing.*/, ""), tone: "neutral", read: brief.lines[0] });

  return out;
}

// ── teaching metrics (firm value vs field — "compare and contrast") ─────────
export function cockpitMetrics(desk: CockpitDesk, view: GameView): Metric[] {
  const r = view.ownResult;
  const you = view.firms.find((f) => f.isYou);
  const out: Metric[] = [];

  if (desk === "finance" && r) {
    const cc = r.cost_of_capital;
    out.push({ label: "Coverage (EBIT/int)", value: `${cc.coverage.toFixed(1)}×`, tone: cc.coverage >= 3 ? "good" : cc.coverage >= 1.5 ? "watch" : "risk", hint: "Operating profit ÷ interest. Below 1.5×, the bank charges a penalty rate." });
    out.push({ label: "Leverage", value: `${cc.leverage.toFixed(2)}×`, field: fieldOf(view, () => `${fieldMed(view, (f) => f.leverage).toFixed(2)}×`), tone: vsField(view, cc.leverage, (f) => f.leverage, false, 0.2), hint: "Debt ÷ equity. Debt lets the firm grow faster, and makes losses bigger when a shock hits." });
    out.push({ label: "Cost of debt", value: fmt.pct1(cc.r_debt), tone: "neutral", hint: "The rate on new borrowing. It rises with more debt and with thin interest coverage." });
    out.push({ label: "Net income", value: fmt.signed(r.pnl.net_income), field: fieldOf(view, () => fmt.money(fieldMed(view, (f) => f.netIncome))), tone: r.pnl.net_income >= 0 ? "good" : "risk", hint: "Profit on the books, not cash in the bank. A profitable firm can still run out of cash." });
  }

  if (desk === "operations") {
    const { sold, desired } = volumes(view);
    const util = utilization(view, sold);
    if (r) out.push({ label: "Utilization", value: fmt.pct(util), tone: util >= 0.95 ? "watch" : util >= 0.7 ? "good" : "risk", hint: "Drinks sold ÷ tank capacity. Near 100% means buyers were turned away; low means idle tanks." });
    out.push({ label: "Unit cost", value: view.own.unit_cost > 0 ? fmt.price(view.own.unit_cost) : view.unitCostEst > 0 ? `≈ ${fmt.price(view.unitCostEst)}` : "—", field: fieldOf(view, () => fmt.price(fieldMed(view, (f) => f.unitCost))), tone: vsField(view, view.own.unit_cost, (f) => f.unitCost, false, 0.08), hint: "Total cost to brew one drink. Brewing experience and operations investment bring it down." });
    // learning and process are MULTIPLIERS on c_base (1.00 = no saving yet), so adding them and
    // printing the sum as a negative was arithmetic nonsense — a firm with no experience and no
    // process investment read "−2.00". The honest figure is the $/drink the two take out of the
    // cost actually charged: unit_cost / (learning·process) is what the drink would have cost
    // without them, so the difference is the saving. (DW-056)
    if (r) {
      const cb = r.cost_buildup;
      const combined = cb.learning * cb.process;
      const saved = combined > 0 ? r.unit_cost / combined - r.unit_cost : 0;
      out.push({
        label: "Learning + process",
        value: saved > 0.005 ? `−${fmt.price(saved)}` : "—",
        tone: saved > 0.005 ? "good" : "neutral",
        hint: saved > 0.005
          ? `Experience and operations investment take ${fmt.price(saved)} off every drink (${fmt.pct(1 - combined)} off the recipe cost). Both keep building over the season.`
          : "Nothing yet. Experience grows with every drink brewed, and operations investment adds to it.",
      });
    }
    out.push({ label: "Capacity", value: fmt.int(view.own.cap), field: fieldOf(view, () => fmt.int(fieldMed(view, (f) => f.cap))), tone: "neutral", hint: `Tanks you own. ${view.capacity ? `This round brews on ${fmt.int(tankOutlook(view.own, view.capacity, 0).capThis)} — after wear-out and anything landing now; ` : ""}new orders come online a round later.` });
    if (view.inventoryEnabled && r?.inventory) out.push({ label: "Inventory turns", value: `${r.inventory.turnover.toFixed(1)}×`, tone: r.inventory.turnover < 1 ? "watch" : "good", hint: "Higher means less cash tied up in stock, and less of it spoils." });
  }

  if (desk === "commercial") {
    for (const s of view.segments.filter((x) => x.active)) {
      const mine = you?.shareBySeg?.[s.id] ?? 0;
      const lead = Math.max(0, ...rivals(view).map((f) => f.shareBySeg?.[s.id] ?? 0));
      out.push({ label: `${SEG_TAG[s.id] ?? s.id} share`, value: fmt.pct(mine), field: fieldOf(view, () => fmt.pct(lead), "leader"), tone: !fieldSeen(view) ? "neutral" : mine >= lead ? "good" : mine >= lead * 0.6 ? "watch" : "risk", hint: "Your share of this category, against the rival with the biggest share." });
    }
    out.push({ label: "Brand stock", value: view.own.B.toFixed(0), field: fieldOf(view, () => fieldMed(view, (f) => f.B).toFixed(0)), tone: vsField(view, view.own.B, (f) => f.B, true), hint: "Brand draws buyers for many rounds, but it fades without spending." });
    if (r?.distinctiveness) out.push({ label: "Nearest rival", value: r.distinctiveness.nearest_neighbor.toFixed(2), tone: "neutral", hint: "How different your strategy is from your closest rival's. Close rivals compete for the same shoppers." });
  }

  if (desk === "people") {
    out.push({ label: "Employee relations", value: view.own.T_emp.toFixed(0), field: fieldOf(view, () => fieldMed(view, (f) => f.T_emp).toFixed(0)), tone: vsField(view, view.own.T_emp, (f) => f.T_emp, true, 0.15), hint: "Morale. It raises productivity, so it shows up in unit cost." });
    const roster = you?.employees ?? [];
    if (roster.length) {
      const avgSat = roster.reduce((a, e) => a + e.satisfaction, 0) / roster.length;
      const avgSkill = roster.reduce((a, e) => a + e.skill, 0) / roster.length;
      out.push({ label: "Crew satisfaction", value: fmt.pct(avgSat), tone: avgSat < 0.45 ? "risk" : avgSat < 0.6 ? "watch" : "good", hint: "Below about 45%, rivals can hire them away." });
      out.push({ label: "Avg skill", value: avgSkill.toFixed(2), tone: "neutral", hint: "Average skill of your named staff. Skill raises what quality spending buys." });
    }
    out.push({ label: "Headcount", value: String(roster.length), field: fieldOf(view, () => String(Math.round(median(rivals(view).map((f) => f.employees.length))))), tone: "neutral", hint: "Named staff on the payroll." });
  }

  if (desk === "strategy") {
    out.push({ label: "Regulator trust", value: view.own.T_gov.toFixed(0), field: fieldOf(view, () => fieldMed(view, (f) => f.T_gov).toFixed(0)), tone: vsField(view, view.own.T_gov, (f) => f.T_gov, true, 0.15), hint: "Regulators' trust in you. It lowers the chance of fines and adds weight to lobbying." });
    if (view.own.reputation) out.push({ label: "Reputation", value: view.own.reputation.toFixed(0), tone: "neutral", hint: "Built by keeping your pacts. It lowers what lenders and investors charge you." });
    out.push({ label: "Active pacts", value: String(view.agreements.length), tone: "neutral", hint: "Pacts with rivals in force. Partners can walk away." });
    out.push({ label: "Valuation", value: fmt.money(you?.valuation ?? 0), field: fieldOf(view, () => fmt.money(fieldMed(view, (f) => f.valuation))), tone: vsField(view, you?.valuation ?? 0, (f) => f.valuation, true), hint: "What the firm is worth: the price a buyer would start from." });
  }

  if (desk === "all" && r) {
    const sc = r.scorecard_norm;
    out.push({ label: "Financial", value: sc.financial.toFixed(2), tone: sc.financial >= 0 ? "good" : "risk", hint: "Profit against what your capital costs." });
    out.push({ label: "Market", value: sc.market.toFixed(2), tone: sc.market >= 0 ? "good" : "risk", hint: "Market share and demand for your beer." });
    // Student-facing labels per the scoring-layer spec §8: say what the component
    // DOES, not what it is — engine keys stay generic.
    out.push({ label: "Preparedness", value: sc.intangible.toFixed(2), tone: sc.intangible >= 0 ? "good" : "risk", hint: "What you have built for later rounds: quality, brand and operations." });
    out.push({ label: "Standing", value: sc.stakeholder.toFixed(2), tone: sc.stakeholder >= 0 ? "good" : "risk", hint: "The trust of your staff, investors and regulators." });
    out.push({ label: "Valuation", value: fmt.money(you?.valuation ?? 0), field: fieldOf(view, () => fmt.money(fieldMed(view, (f) => f.valuation))), tone: vsField(view, you?.valuation ?? 0, (f) => f.valuation, true), hint: "What the firm is worth, all of the above in one number." });
  }

  return out;
}
