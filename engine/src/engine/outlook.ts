/**
 * DW-083 · What a quarter costs before a single drink sells.
 *
 * The Decide form's "projected cash · pre-sales" counted what a plan spends (tanks, programs,
 * builds, hires) and the financing it raises, but not the costs the round charges anyway: G&A,
 * upkeep on every tank online, the regulatory burden, facility running costs, payroll and
 * interest. In Sprint 2 those ran $60–170k a round — 15–30% of a healthy firm's revenue and
 * several times a failing firm's — and five of the six closures came after a positive
 * projection. This prices them with the round's own formulas on the state the form sees, so the
 * form can say what sales must cover. Interest uses last quarter's rate (this quarter's depends on
 * coverage, i.e. on sales); distribution, tariffs and shipping scale with what sells and are left
 * to the per-drink margin.
 */
import type { Config, FirmDecision, FirmState } from "../types.js";
import { advancePipeline, updateStock } from "./stocks.js";
import { regulatoryBurden } from "./finance.js";
import { verticalRegRelief } from "./assets.js";

export interface RunningCosts {
  overhead: number;
  tank_upkeep: number;
  regulatory: number;
  facilities: number; // fixed running cost (rent-adjusted) of every active facility, incl. this round's builds
  payroll: number; // staff + key-hire salaries already on the books (new hires are counted by the plan itself)
  interest: number; // at `rate` on the debt after this round's financing
  total: number;
}

// `stocks` is optional: the student view doesn't carry it, and without it T_gov is read as it
// stands rather than advanced one round (a few dollars of regulatory burden).
type CostConfig = Pick<Config, "finance" | "capacity" | "modules"> & { stocks?: Config["stocks"] };

/** The cap stock (and T_gov) the round will charge on: last round's matured investment lands first. */
const advanced = (prev: number, pipeline: number[] | undefined, lag: number, invest: number, sp: { depreciation: number; gain: number; conversion: "linear" | "sqrt" | "log" }) =>
  updateStock(prev, sp.depreciation, advancePipeline(pipeline ?? [], lag, invest).matured, sp.conversion, sp.gain);

export function runningCostEstimate(f: FirmState, d: FirmDecision, c: CostConfig, round: number, opts: { debtAfter: number; rate: number }): RunningCosts {
  const overhead = c.finance.fixed_overhead;
  const cap = advanced(f.cap, f.pipelines?.cap, c.capacity.lag, d.invest_cap, c.capacity);
  const tank_upkeep = c.capacity.fixed_cost_per_unit * cap;
  const tGov = c.stocks ? advanced(f.T_gov, f.pipelines?.T_gov, c.stocks.T_gov.lag, d.invest_T_gov, c.stocks.T_gov) : f.T_gov;
  const regulatory = regulatoryBurden(tGov, c as Config) * (1 - Math.min(1, Math.max(0, verticalRegRelief(f, c as Config, round))));

  let facilities = 0;
  const fac = c.modules?.facilities;
  if (fac?.enabled) {
    const rent = (loc?: string) => fac.districts?.find((x) => x.id === loc)?.rent_mult ?? 1;
    const typeOf = (id: string) => fac.types.find((t) => t.id === id);
    const mothball = new Set(d.mothball_facilities ?? []), wake = new Set(d.reactivate_facilities ?? []), sold = new Set(d.divest_facilities ?? []);
    for (const x of f.facilities ?? []) {
      if (sold.has(x.id)) continue;
      const on = (x.active && !mothball.has(x.id)) || wake.has(x.id);
      const t = typeOf(x.type);
      if (on && t) facilities += Math.round(t.fixed_cost * rent(x.location_id));
    }
    const lots = (mk?: string) => c.modules?.geography?.markets.find((m) => m.id === (mk ?? "home"))?.lots ?? [];
    for (const b of d.build_facilities ?? []) {
      const t = typeOf(b.type);
      if (!t) continue;
      const loc = b.lot ? lots(b.market).find((L) => L.id === b.lot)?.district : (b.location ?? fac.districts?.[0]?.id);
      facilities += Math.round(t.fixed_cost * rent(loc));
    }
  }

  let payroll = 0;
  if (c.modules?.employees?.enabled) {
    const fired = new Set(d.fire_employees ?? []);
    for (const e of f.employees ?? []) if (!fired.has(e.id)) payroll += e.salary; // a raise's increase is counted by the plan itself
  }
  const lab = c.modules?.laborMarket;
  if (lab?.enabled) {
    const fired = new Set(d.fire_roles ?? []);
    for (const h of f.key_hires ?? []) if (!fired.has(h.role)) payroll += lab.roles.find((r) => r.id === h.role)?.salary ?? 0;
  }

  const interest = Math.max(0, opts.rate) * Math.max(0, opts.debtAfter);
  return { overhead, tank_upkeep, regulatory, facilities, payroll, interest, total: overhead + tank_upkeep + regulatory + facilities + payroll + interest };
}
