/**
 * DW-083 item 2 · Sources and uses — one affordability check before anything is bought.
 *
 * Sprint 2 (2026-11-03): three firms closed on orders they could not pay for. Tank capex had no
 * cash check at all; builds, vertical assets and hires were each checked alone against BEGINNING
 * cash, so six builds each under $722k passed together ($1.28M), and a loan the bank refused
 * cancelled nothing. This pass runs once per firm on the beginning-of-round state, after the
 * round's financing is priced (financingGrant — the same function the Decide form calls):
 *
 *   sources   = cash + the draw the bank will grant + the net equity investors will fund
 *               (+ MOD-B08 instrument draws: the convertible as the books cap it, the revenue-based
 *               draw as asked — its cap is this round's revenue)
 *   committed = the round's operating programs (quality, brand, process, stakeholder programs,
 *               research, market entry, maintenance, raises) — counted, never cut here
 *   orders    = tanks, facility builds (+ bid premiums), vertical assets, key hires, staff hires
 *   payouts   = dividend, debt repayment
 *
 * If committed + orders + payouts > sources, payouts and orders are cut in a fixed order —
 * dividend → repayment → tanks → builds → vertical assets → key hires → staff hires (each list
 * from its last entry back) — until the plan fits, and the firm is told what was cut and why.
 * "scale" trims the dividend, the repayment and the tank order to what fits; "block" drops each
 * item whole. Discrete items (a build, an asset, a hire) are always all-or-nothing. A repayment is
 * only cut as far as it frees cash: at the leverage cap the bank re-lends what the repayment freed,
 * dollar for dollar, so cutting it there changes nothing but the news.
 *
 * This round's sales are not in the sum: they settle inside the quarter, which is what the overdraft /
 * exit rule governs. Running costs (overhead, tank upkeep, regulatory burden, rent, payroll, interest)
 * are set aside first when `reserve_running_costs` is on (v3 audit): a treasurer keeps the quarter's
 * bills in the bank before approving orders, so a trimmed plan never starts the quarter at $0 with
 * $60–100k due whatever it sells. Absent from the config ⇒ never called; the engine is the Sprint 1–2 engine.
 */
import type { Candidate, Config, FirmDecision, FirmState } from "../types.js";
import { debtRate, financingGrant, type FinancingGrant } from "./finance.js";
import { activeMarkets } from "./geography.js";
import { runningCostEstimate } from "./outlook.js";

export type GuardItemKind = "dividend" | "repay" | "tanks" | "build" | "vertical" | "key_hire" | "staff_hire";
export interface GuardCut { kind: GuardItemKind; label: string; asked: number; kept: number }
export interface AffordabilityResult {
  decision: FirmDecision; // the plan with the cuts applied (unchanged when it fits)
  grant: FinancingGrant; // financing priced on the beginning state, at the (possibly trimmed) repayment
  sources: number;
  instruments: number; // MOD-B08 draws counted inside `sources` (0 when the module is off)
  reserve: number; // running costs set aside before orders (0 when reserve_running_costs is off)
  committed: number;
  orders: number;
  payouts: number;
  cuts: GuardCut[];
  events: string[];
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Operating programs the round commits to — counted against sources, never cut by the guard. */
export function committedSpend(f: FirmState, d: FirmDecision, c: Config, round: number): number {
  const m = c.modules;
  let s = d.invest_Q + d.invest_B + d.invest_process + d.invest_T_emp + d.invest_T_inv + d.invest_T_gov;
  if (d.buy_info) s += c.information.cost;
  if (m?.geography?.enabled) {
    const entered = f.markets_entered ?? ["home"];
    for (const mk of activeMarkets(c, round)) {
      if (mk.kind === "home" || entered.includes(mk.id)) continue;
      if ((d.market_presence?.[mk.id] ?? 0) > 0 || (d.market_supply?.[mk.id] ?? 0) > 0) s += mk.entry_cost;
    }
  }
  if (m?.facilities?.enabled) for (const v of Object.values(d.maintain_facilities ?? {})) s += Math.max(0, v);
  if (m?.sustainability?.enabled) s += Math.max(0, d.invest_water_efficiency ?? 0);
  if (m?.rndRace?.enabled) s += Math.max(0, d.invest_rnd ?? 0);
  if (m?.publicGoods?.enabled) for (const v of Object.values(d.public_good_contributions ?? {})) s += Math.max(0, v);
  if (m?.lobbying?.enabled && (d.lobby_initiative || d.lobby_counter)) s += Math.max(0, d.lobby_spend ?? 0);
  if (m?.prEvents?.enabled && d.pr_action) s += m.prEvents.cost;
  if (m?.employees?.enabled) {
    for (const [id, raw] of Object.entries(d.raise_employees ?? {})) {
      const e = f.employees?.find((x) => x.id === id);
      if (e && raw > e.salary) s += raw - e.salary;
    }
  }
  return s;
}

/** MOD-B08: what this round's instrument draws will put in — the convertible note as the books cap it
 *  (a fraction of equity after this round's raise, one note at a time); the revenue-based draw as asked
 *  (the books cap it on this round's revenue, unknown before sales; one facility at a time). 0 when off. */
export function instrumentDrawsEstimate(
  f: Pick<FirmState, "paid_in_capital" | "retained_earnings" | "convertible_note" | "rbf_outstanding">, d: FirmDecision, c: Pick<Config, "modules">, equityNet = 0,
): number {
  const fi = c.modules?.financialInstruments;
  if (!fi?.enabled) return 0;
  let s = 0;
  if (!f.convertible_note && (d.draw_convertible ?? 0) > 0) {
    s += Math.min(Math.max(0, d.draw_convertible ?? 0), fi.convertible.max_equity_fraction * Math.max(0, f.paid_in_capital + equityNet + f.retained_earnings));
  }
  if (!((f.rbf_outstanding ?? 0) > 1e-9) && (d.draw_rbf ?? 0) > 0) s += Math.max(0, d.draw_rbf ?? 0);
  return s;
}

interface Item { kind: GuardItemKind; label: string; amount: number; continuous: boolean; idx?: number }

export function applyAffordabilityGuard(
  f: FirmState, dIn: FirmDecision, c: Config, round: number, equityCap = Infinity, candidates: Candidate[] = [],
): AffordabilityResult {
  const mode = c.finance.affordability_guard?.mode ?? "scale";
  const m = c.modules;
  const d: FirmDecision = { ...dIn };
  let grant = financingGrant(f, c, d, equityCap);
  const committed = committedSpend(f, d, c, round);

  // Orders, in the order they are cut (each list from its last entry back).
  const items: Item[] = [];
  items.push({ kind: "dividend", label: "dividend", amount: Math.max(0, d.dividend), continuous: true });
  items.push({ kind: "repay", label: "debt repayment", amount: grant.repay, continuous: true });
  items.push({ kind: "tanks", label: "tank order", amount: Math.max(0, d.invest_cap), continuous: true });
  const builds = m?.facilities?.enabled ? (d.build_facilities ?? []) : [];
  for (let i = builds.length - 1; i >= 0; i--) {
    const t = m!.facilities!.types.find((x) => x.id === builds[i].type);
    if (!t) continue;
    const where = builds[i].market && m?.geography?.enabled ? m.geography.markets.find((x) => x.id === builds[i].market)?.label : undefined;
    items.push({ kind: "build", label: `${t.label.toLowerCase()}${where ? ` (${where})` : ""}`, amount: t.base_cost + Math.max(0, builds[i].bid ?? 0), continuous: false, idx: i });
  }
  const owned = new Set((f.vertical_assets ?? []).map((a) => a.id));
  const vert = m?.verticalIntegration?.enabled ? (d.buy_vertical ?? []) : [];
  for (let i = vert.length - 1; i >= 0; i--) {
    const a = m!.verticalIntegration!.assets.find((x) => x.id === vert[i]);
    if (a && !owned.has(a.id)) items.push({ kind: "vertical", label: a.label.toLowerCase(), amount: a.cost, continuous: false, idx: i });
  }
  const onStaff = new Set((f.key_hires ?? []).map((h) => h.role));
  const roles = m?.laborMarket?.enabled ? (d.hire_roles ?? []) : [];
  for (let i = roles.length - 1; i >= 0; i--) {
    const r = m!.laborMarket!.roles.find((x) => x.id === roles[i]);
    if (r && !onStaff.has(r.id)) items.push({ kind: "key_hire", label: r.label.toLowerCase(), amount: r.signing_bonus + r.salary, continuous: false, idx: i });
  }
  if (m?.employees?.enabled) {
    const poach = d.poach_employees ?? [];
    for (let i = poach.length - 1; i >= 0; i--) items.push({ kind: "staff_hire", label: "a poaching offer", amount: Math.max(0, poach[i].offer), continuous: false, idx: -1 - i });
    const hires = d.hire_employees ?? [];
    for (let i = hires.length - 1; i >= 0; i--) {
      const cand = candidates.find((x) => x.id === hires[i]);
      if (cand) items.push({ kind: "staff_hire", label: `${cand.name}'s hire`, amount: cand.salary + Math.max(0, d.hire_bids?.[cand.id] ?? 0), continuous: false, idx: i });
    }
  }

  const orderSum = () => items.filter((x) => x.kind !== "dividend" && x.kind !== "repay").reduce((a, x) => a + x.amount, 0);
  const payoutSum = () => items.filter((x) => x.kind === "dividend" || x.kind === "repay").reduce((a, x) => a + x.amount, 0);
  const instruments = instrumentDrawsEstimate(f, d, c, grant.equityNet); // equityNet doesn't move with a repayment
  // The quarter's running costs, priced on the state the guard sees (interest at the pre-penalty rate on the
  // debt after this request). Needs the capacity block; a caller without it (an older client) reserves nothing.
  let reserve = 0;
  if (c.finance.affordability_guard?.reserve_running_costs && c.capacity) {
    const debtAfter = f.debt + grant.draw - grant.repay;
    const lev = Math.min(10, debtAfter / Math.max(grant.equityAfter, 1e-9));
    reserve = runningCostEstimate(f, d, c, round, { debtAfter, rate: debtRate(lev, f.T_inv, c) }).total;
  }
  const sourcesOf = (g: FinancingGrant) => f.cash + g.draw + g.equityNet + instruments - reserve;
  const asked = new Map(items.map((x) => [x, x.amount]));
  let gap = committed + orderSum() + payoutSum() - sourcesOf(grant);
  const sources0 = sourcesOf(grant);
  const orders0 = orderSum(), payouts0 = payoutSum();

  for (const it of items) {
    if (gap <= 0.5) break;
    if (it.amount <= 0) continue;
    let cut = it.continuous && mode === "scale" ? Math.min(it.amount, gap) : it.amount;
    if (it.kind === "repay") {
      // Less repaid ⇒ more of the old debt counts against the leverage cap. Once the request sits at the
      // cap, every dollar not repaid is a dollar the bank won't lend: a wash that frees nothing and would
      // only tell the firm its repayment was "dropped". Only the part the bank doesn't claw back is a real
      // cut — scale trims to it; block drops the repayment only when that part is worth anything.
      const headroom = Math.max(0, grant.creditCapacity - grant.requestedDraw);
      if (mode === "scale") cut = Math.min(cut, headroom);
      else if (headroom < 0.5) cut = 0;
      if (cut < 0.5) continue;
      it.amount -= cut;
      const before = grant.draw;
      grant = financingGrant(f, c, { ...d, debt_repay: it.amount }, equityCap);
      gap -= cut - (before - grant.draw); // what the cut freed, net of any draw lost with it
      continue;
    }
    it.amount -= cut;
    gap -= cut;
  }

  const cuts: GuardCut[] = items.filter((x) => (asked.get(x) ?? 0) - x.amount >= 0.5).map((x) => ({ kind: x.kind, label: x.label, asked: asked.get(x) ?? 0, kept: x.amount }));
  const events: string[] = [];
  if (cuts.length) {
    // Write the trimmed plan back.
    for (const x of items) {
      if (x.kind === "dividend") d.dividend = x.amount;
      else if (x.kind === "repay") d.debt_repay = x.amount;
      else if (x.kind === "tanks") d.invest_cap = x.amount;
    }
    const dropped = (kind: GuardItemKind) => new Set(items.filter((x) => x.kind === kind && x.amount === 0 && (asked.get(x) ?? 0) > 0).map((x) => x.idx!));
    const db = dropped("build"), dv = dropped("vertical"), dk = dropped("key_hire"), ds = dropped("staff_hire");
    if (d.build_facilities && db.size) d.build_facilities = d.build_facilities.filter((_, i) => !db.has(i));
    if (d.buy_vertical && dv.size) d.buy_vertical = d.buy_vertical.filter((_, i) => !dv.has(i));
    if (d.hire_roles && dk.size) d.hire_roles = d.hire_roles.filter((_, i) => !dk.has(i));
    if (ds.size) {
      if (d.hire_employees) {
        const gone = new Set(d.hire_employees.filter((_, i) => ds.has(i)));
        d.hire_employees = d.hire_employees.filter((id) => !gone.has(id));
        if (d.hire_bids) d.hire_bids = Object.fromEntries(Object.entries(d.hire_bids).filter(([id]) => !gone.has(id)));
      }
      if (d.poach_employees) d.poach_employees = d.poach_employees.filter((_, i) => !ds.has(-1 - i));
    }
    const refused = grant.requestedDraw - grant.draw >= 0.5
      ? `; the bank lends ${money(grant.draw)} of the ${money(grant.requestedDraw)} asked`
      : "";
    const list = cuts.map((x) => (x.kept >= 0.5 ? `${x.label} ${money(x.asked)} → ${money(x.kept)}` : `${x.label} (${money(x.asked)}) dropped`)).join(", ");
    events.push(`BLOCKED: ${f.id} cannot pay for its whole plan — ${money(committed + orders0 + payouts0)} of spending against ${money(sources0)} of cash and financing${reserve >= 0.5 ? ` after ${money(reserve)} set aside for running costs` : ""}${refused}. Cut: ${list}`);
  }
  return { decision: d, grant, sources: sourcesOf(grant), instruments, reserve, committed, orders: orderSum(), payouts: payoutSum(), cuts, events };
}
