/**
 * MOD-B05 · Within-team roles. Each round, a firm receives four role-tagged intel
 * briefings — the CFO, CMO, COO, and CEO each see a different slice of the truth,
 * with role-specific noise. The team has to integrate conflicting partial reads
 * into one locked decision. Deterministic per (seed, round, firm) so replays and
 * refreshes show the same briefs.
 *
 * (The spec's per-member privacy + individual-recommendation logging is the
 * research-instrument half and is deferred; this delivers the decision-making half.)
 */
import type { Config, FirmId, SegmentId, WorldState } from "../types.js";
import { RNG, deriveSeed } from "../rng.js";

/** The same read as numbers (11-07 readability pass): the Boardroom renders these as label → value rows and
 *  a one-line verdict, and its seat popovers chart them. Same noise as the prose; additive (older clients
 *  read `lines`). Firm ids stay ids here — the client names them. */
export type BriefingData =
  | { role: "cfo"; rivalLeverage: number; yourLeverage: number; stretched: boolean }
  | { role: "cmo"; nextDemand: { seg: SegmentId; units: number }[]; biggest: SegmentId | null; drift: boolean }
  | { role: "coo"; unitCost: number; matureProcess: boolean; estimated: boolean }
  | { role: "ceo"; watch: FirmId | null; posture: "quality-led" | "brand-led" | "balanced" | null; murky: boolean; outscaled: boolean };

export interface RoleBriefing {
  role: "cfo" | "cmo" | "coo" | "ceo";
  title: string;
  lines: string[];
  data?: BriefingData;
}

const firmIndex = (id: FirmId): number => Number(id.replace(/[^0-9]/g, "")) || 0;

/** Comma-grouped integer for prose ("489,702", not "489702"). Explicit locale keeps
 *  the output deterministic across environments. */
const fm = (n: number): string => Math.round(n).toLocaleString("en-US");

export function roleBriefings(world: WorldState, c: Config, firmId: FirmId): RoleBriefing[] {
  const cfg = c.modules?.teamRoles;
  if (!cfg?.enabled) return [];
  const me = world.firms.find((f) => f.id === firmId);
  if (!me || me.status !== "active") return [];
  const rng = new RNG(deriveSeed(world.seed, world.round, 500 + firmIndex(firmId)));
  const rivals = world.firms.filter((f) => f.status === "active" && f.id !== firmId);
  const noisy = (x: number, sd: number) => x * (1 + rng.normal(0, sd));
  // RNG draw order is fixed (cfo → cmo per segment → coo → ceo) so a round's briefs never change on refresh.

  // CFO — capital-markets read: rival leverage + your borrowing posture.
  const avgLev = rivals.length
    ? rivals.reduce((a, f) => a + f.debt / Math.max(1e-6, f.paid_in_capital + f.retained_earnings), 0) / rivals.length
    : 0;
  const myLev = me.debt / Math.max(1e-6, me.paid_in_capital + me.retained_earnings);
  const rivalLev = noisy(avgLev, cfg.noise.cfo);
  const stretched = myLev > avgLev * 1.2;
  const cfo: RoleBriefing = {
    role: "cfo",
    title: "CFO briefing — capital",
    lines: [
      `Leverage: rivals ~${rivalLev.toFixed(2)}× · yours ${myLev.toFixed(2)}×.`,
      stretched ? "Most stretched at the table — borrowing gets pricier." : "Stronger balance sheet than the field — room to borrow.",
    ],
    data: { role: "cfo", rivalLeverage: rivalLev, yourLeverage: myLev, stretched },
  };

  // CMO — demand read: where the market is heading next round.
  const segs = world.segments.filter((s) => s.active);
  const grow = segs.map((s) => {
    const sc = c.segments.find((x) => x.id === s.id)!;
    return { id: s.id, next: noisy(s.D * sc.growth, cfg.noise.cmo) };
  });
  const biggest = [...grow].sort((a, b) => b.next - a.next)[0];
  const drift = !!c.modules?.consumerDrift?.enabled;
  const cmo: RoleBriefing = {
    role: "cmo",
    title: "CMO briefing — demand",
    lines: [
      ...grow.map((g) => `${g.id}: ~${fm(g.next)} drinks next round.`),
      biggest ? `Biggest pool next round: ${biggest.id}.` : "",
      drift ? "Mainstream drinkers are trending toward quality." : "",
    ].filter(Boolean),
    data: { role: "cmo", nextDemand: grow.map((g) => ({ seg: g.id, units: g.next })), biggest: biggest?.id ?? null, drift },
  };

  // COO — operations read: your true cost position. 11-07 (Devin): a firm knows its own unit cost, so this
  // number is exact — the same estimate the pricing card shows (last round's cost; before any round,
  // 85% of base, as both transports estimate it). The noise draw is still taken, so the CEO's read keeps
  // its place in the sequence.
  void rng.normal(0, cfg.noise.coo);
  const estimated = !(me.unit_cost > 0);
  const unitCost = estimated ? c.costs.c_base * 0.85 : me.unit_cost;
  const matureProcess = me.process > 25;
  const coo: RoleBriefing = {
    role: "coo",
    title: "COO briefing — operations",
    lines: [
      `Unit cost ${estimated ? "~" : ""}$${unitCost.toFixed(2)} a drink.`,
      matureProcess ? "Process maturity is paying off — yields beat the field's baseline." : "Easy yield left — process investment cuts cost fastest.",
    ],
    data: { role: "coo", unitCost, matureProcess, estimated },
  };

  // CEO — competitive read: the strongest rival and their posture.
  const strongest = [...rivals].sort((a, b) => b.Q + b.B - (a.Q + a.B))[0];
  const posture = strongest ? (strongest.Q > strongest.B * 1.2 ? "quality-led" : strongest.B > strongest.Q * 1.2 ? "brand-led" : "balanced") : null;
  const murky = strongest ? rng.bool(cfg.noise.ceo * 2) : false;
  const outscaled = !!strongest && strongest.cap > me.cap * 1.3;
  const ceo: RoleBriefing = {
    role: "ceo",
    title: "CEO briefing — the field",
    lines: strongest
      ? [
          `One to watch: ${strongest.id} — ${posture}${murky ? " (murky read)" : ""}.`,
          outscaled ? "They out-scale you — a volume fight is uphill." : "Even on scale — position, don't out-spend.",
        ]
      : ["The field has thinned out. The market is yours to lose."],
    data: { role: "ceo", watch: strongest?.id ?? null, posture, murky, outscaled },
  };

  return [cfo, cmo, coo, ceo];
}
