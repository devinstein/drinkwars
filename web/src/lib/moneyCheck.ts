/**
 * What the round will actually fund on a plan — the affordability guard's cuts and the bank's and investors'
 * caps — in one place, so the Tanks card, the commit rail, the Round Table and the "Before you submit" check
 * all say the same thing before anyone submits (11-06, Devin: a student who orders $1.2M of tanks and gets
 * $398k, or asks for a $1M loan and gets $427k, must know it before the round runs, not after).
 *
 * Same functions, same config slice as the engine: both clients build the view from the game's own config, and
 * `stocks` rides along so the running-cost reserve (regulatory cost follows the T_gov stock) matches the
 * engine's to the dollar — the preview once said $398,960 where the engine cut to $398,539.
 */
import { applyAffordabilityGuard, creditReason, debtRate, equityCapacity, financingGrant, runningCostEstimate } from "drinkwars-engine";
import type { Config, FinancingGrant, FirmDecision, GuardCut } from "drinkwars-engine";
import type { GameView } from "../game/controller.js";
import { fmt } from "../labels.js";
import { tankOutlook } from "./tanks.js";

/** The config slice the guard and the running-cost estimate read. */
export const guardConfig = (view: GameView, infoCost: number): Config =>
  ({ finance: view.finance, capacity: view.capacity, modules: view.modules, stocks: view.stocks, information: { cost: infoCost } }) as unknown as Config;

/** The quarter's running costs exactly as the guard prices its reserve: interest at the pre-penalty rate on the debt
 *  after this plan's financing. The rail once priced it at last quarter's rate ($107,161 beside a $135,781 reserve on a
 *  $1.8M draw), so the panels disagreed with each other and with the engine. */
export function runningCostsAsGuard(view: GameView, plan: FirmDecision, grant: Pick<FinancingGrant, "draw" | "repay" | "equityAfter">) {
  const debtAfter = view.own.debt + grant.draw - grant.repay;
  const lev = Math.min(10, debtAfter / Math.max(grant.equityAfter, 1e-9));
  const cfg = guardConfig(view, 0); // research isn't a running cost
  return runningCostEstimate(view.own, plan, cfg, view.round, { debtAfter, rate: debtRate(lev, view.own.T_inv, cfg) });
}

export interface TankCut { asked: number; kept: number; unitsAsked: number; unitsKept: number; when: string }
export interface MoneyOutcome {
  grant: FinancingGrant;
  cuts: GuardCut[]; // what the guard would cut (empty when the plan fits, or the guard is off)
  reserve: number; // running costs set aside before orders
  sources: number; // cash + the financing that will actually land, net of the reserve
  spend: number; // everything the plan asks to spend
  tank: TankCut | null; // set when the tank order is cut
  loan: { asked: number; lent: number; why: string } | null; // set when the bank lends less than asked
  equity: { asked: number; raised: number } | null; // set when investors fund less than asked
  lines: string[]; // the submit check's sentences — empty when the plan runs as entered
}

const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function moneyOutcome(view: GameView, plan: FirmDecision, infoCost: number): MoneyOutcome | null {
  if (!view.finance || !view.own) return null;
  const fin = { finance: view.finance };
  const equityCap = equityCapacity(view.own, fin);
  const cfg = guardConfig(view, infoCost);
  const guard = view.finance.affordability_guard ? applyAffordabilityGuard(view.own, plan, cfg, view.round, equityCap, view.hiringMarket) : null;
  const grant = guard?.grant ?? financingGrant(view.own, fin, plan, equityCap);
  const cuts = guard?.cuts ?? [];
  const cc = view.capacity;
  const when = !cc || cc.lag === 1 ? "next quarter" : cc.lag <= 0 ? "this quarter" : `in ${cc.lag} quarters`;
  const units = (dollars: number) => (cc && cc.gain > 0 ? tankOutlook(view.own, cc, dollars).added : 0);
  const tc = cuts.find((x) => x.kind === "tanks");
  const tank = tc && cc ? { asked: tc.asked, kept: tc.kept, unitsAsked: units(tc.asked), unitsKept: units(tc.kept), when } : null;
  const loanAsked = grant.requestedDraw;
  const loan = loanAsked - grant.draw >= 0.5 ? { asked: loanAsked, lent: grant.draw, why: creditReason(grant.limits, grant.equityAfter, fin, "your") } : null;
  const equity = grant.equityAsked - grant.equityGross >= 0.5 ? { asked: grant.equityAsked, raised: grant.equityGross } : null;
  const spend = guard ? guard.committed + guard.orders + guard.payouts + cuts.reduce((a, x) => a + x.asked - x.kept, 0) : 0;

  const m = fmt.money, n = fmt.int;
  const lines: string[] = [];
  if (loan) lines.push(loan.lent < 0.5
    ? `Loan: the bank won't lend this quarter (${loan.why}). None of the ${m(loan.asked)} you asked for arrives.`
    : `Loan: the bank lends ${m(loan.lent)} of the ${m(loan.asked)} you asked for (${loan.why}).`);
  if (equity) lines.push(equity.raised < 0.5
    ? `Equity: no investor will buy in this quarter. None of the ${m(equity.asked)} you asked for arrives.`
    : `Equity: investors put in ${m(equity.raised)} of the ${m(equity.asked)} you asked for. Each quarter they invest at most a set share of what the firm is worth.`);
  if (cuts.length && guard) {
    lines.push(`This plan spends ${m(spend)}. Your cash and the financing you'll get cover ${m(guard.sources)}${guard.reserve >= 0.5 ? `, after ${m(guard.reserve)} is set aside for this quarter's running costs` : ""}. If you submit it as it is, the round cuts:`);
    for (const x of cuts) {
      if (x.kind === "tanks" && tank) lines.push(tank.kept >= 0.5
        ? `Tank order: ${m(x.asked)} → ${m(x.kept)}. That adds ${n(tank.unitsKept)} units of capacity ${when}, not ${n(tank.unitsAsked)}.`
        : `Tank order (${m(x.asked)}): dropped, so no new capacity arrives ${when}.`);
      else if (x.kept >= 0.5) lines.push(`${cap1(x.label)}: ${m(x.asked)} → ${m(x.kept)}.`);
      else lines.push(`${cap1(x.label)} (${m(x.asked)}): dropped.`);
    }
  }
  return { grant, cuts, reserve: guard?.reserve ?? 0, sources: guard?.sources ?? 0, spend, tank, loan, equity, lines };
}

/** Dollars → units of tank capacity, by the game's own conversion (for the after-round "Orders cut" notice). */
export const tankUnitsOf = (view: GameView): ((dollars: number) => number) | undefined =>
  view.capacity && view.capacity.gain > 0 ? (dollars: number) => tankOutlook(view.own, view.capacity!, dollars).added : undefined;
