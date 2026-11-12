/**
 * Design pass 2b (Control Room Glass) — the instrument row: last round's four vital signs as glowing gauges,
 * each with its change from the round before. Capacity use (drinks sold ÷ tanks brewed against), gross margin,
 * interest coverage, and market share (your drinks ÷ all drinks sold). Read from the history every client
 * already holds; nothing new from the engine. Shown once a round has resolved.
 */
import type { GameView } from "../game/controller.js";
import { fmt } from "../labels.js";
import { Card, Eyebrow } from "./ui.js";

type OwnT = GameView["history"][number]["own"];
type FieldT = GameView["history"][number]["field"];
interface Gauge { label: string; value: string; frac: number; color: string; delta: string | null; dtone: "up" | "down" | "flat"; hint: string }

const capUse = (o: OwnT): number | null => ((o.capacity ?? 0) > 0 ? (o.unitsSold ?? 0) / (o.capacity as number) : null);
const margin = (o: OwnT): number | null => ((o.revenue ?? 0) > 0 ? (o.gross ?? 0) / (o.revenue as number) : null);
const share = (o: OwnT, f: FieldT): number | null => (f.totalQ > 0 ? (o.unitsSold ?? 0) / f.totalQ : null);
const NO_DEBT = 900; // coverage above this reads as "no debt" (the engine's figure runs to ~∞)

/** "▲ 2.1 pts" / "▼ 15.9 pts" — a change in a percentage, in points. */
const pts = (a: number | null, b: number | null): [string | null, Gauge["dtone"]] => {
  if (a == null || b == null) return [null, "flat"];
  const d = (a - b) * 100;
  return Math.abs(d) < 0.05 ? ["no change", "flat"] : [`${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)} pts`, d > 0 ? "up" : "down"];
};

export function Instruments({ view }: { view: GameView }) {
  const h = view.history;
  if (!h.length) return null;
  const cur = h[h.length - 1], prev = h.length > 1 ? h[h.length - 2] : null;
  const thr = view.finance?.coverage_threshold ?? 1.5;

  const u = capUse(cur.own), uPrev = prev ? capUse(prev.own) : null;
  const m = margin(cur.own), mPrev = prev ? margin(prev.own) : null;
  const c = cur.own.coverage ?? null, cPrev = prev?.own.coverage ?? null;
  const s = share(cur.own, cur.field), sPrev = prev ? share(prev.own, prev.field) : null;

  const [ud, udt] = pts(u, uPrev);
  const [md, mdt] = pts(m, mPrev);
  const [sd, sdt] = pts(s, sPrev);
  const noDebt = c != null && c > NO_DEBT;
  const cd = c == null || cPrev == null || noDebt || cPrev > NO_DEBT ? null : Math.abs(c - cPrev) < 0.05 ? "no change" : `${c > cPrev ? "▲" : "▼"} ${Math.abs(c - cPrev).toFixed(1)}×`;

  const gauges: Gauge[] = [
    { label: "Capacity use", value: u == null ? "—" : fmt.pct(Math.min(u, 9.99)), frac: Math.min(u ?? 0, 1),
      color: u == null ? "var(--color-faint)" : u >= 0.95 ? "var(--color-copper)" : u < 0.7 ? "var(--color-brick)" : "var(--color-hop)",
      delta: u != null && u >= 0.95 ? "at the limit" : ud, dtone: u != null && u >= 0.95 ? "flat" : udt, hint: "Drinks sold ÷ the tanks you brewed against. At the limit, demand you can't serve is lost; under 70%, idle tanks still cost upkeep." },
    { label: "Gross margin", value: m == null ? "—" : fmt.pct(m), frac: Math.max(0, Math.min((m ?? 0) / 0.6, 1)),
      color: m == null ? "var(--color-faint)" : m < 0 || mdt === "down" ? "var(--color-brick)" : mdt === "up" ? "var(--color-hop)" : "var(--color-copper)",
      delta: md, dtone: mdt, hint: "Gross profit ÷ revenue: what's left of each sales dollar after brewing it." },
    { label: "Interest coverage", value: c == null ? "—" : noDebt ? "no debt" : `${c.toFixed(1)}×`, frac: c == null ? 0 : noDebt ? 1 : Math.max(0, Math.min(c / 10, 1)),
      color: c == null ? "var(--color-faint)" : noDebt || c >= 3 ? "var(--color-hop)" : c >= thr ? "var(--color-copper)" : "var(--color-brick)",
      delta: cd, dtone: c == null || cd == null || cd === "no change" ? "flat" : c > (cPrev ?? 0) ? "up" : "down", hint: `Operating profit ÷ interest. Below ${thr}×, the bank charges a penalty rate.` },
    { label: "Market share", value: s == null ? "—" : fmt.pct(s), frac: Math.min(s ?? 0, 1),
      color: "var(--color-gold)", delta: sd, dtone: sdt, hint: "Your drinks ÷ every drink sold in the market last round." },
  ];
  const DTONE = { up: "var(--color-hop)", down: "var(--color-brick)", flat: "var(--color-inksoft)" };
  const n = cur.own.round + 1;

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3" data-dw="instruments">
        <Eyebrow>Instruments · end of round {n}</Eyebrow>
        <span className="text-[0.68rem] text-inksoft">{prev ? `vs round ${n - 1}` : "first round"}</span>
      </div>
      <div className="grid grid-cols-2 gap-y-2 sm:grid-cols-4">
        {gauges.map((g) => {
          const deg = g.frac * 270;
          return (
            <div key={g.label} className="flex flex-col items-center gap-1.5" title={g.hint}>
              <div className="relative grid h-[88px] w-[88px] place-items-center">
                {/* the glow sits on the wrapper so it follows the masked ring */}
                <div className="absolute inset-0" style={{ filter: `drop-shadow(0 0 6px color-mix(in srgb, ${g.color} 55%, transparent))` }}>
                  <div className="h-full w-full rounded-full" style={{
                    background: `conic-gradient(from 225deg, ${g.color} 0deg ${deg}deg, var(--well) ${deg}deg 270deg, transparent 270deg)`,
                    WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 9px), #000 calc(100% - 8px))",
                    mask: "radial-gradient(farthest-side, transparent calc(100% - 9px), #000 calc(100% - 8px))",
                  }} />
                </div>
                <div className="relative flex flex-col items-center leading-none">
                  <span className={`tnum font-bold text-ink ${g.value.length > 6 ? "text-[0.82rem]" : "text-[1.2rem]"}`}>{g.value}</span>
                  {g.delta && <span className="tnum mt-1 text-[0.62rem] font-semibold" style={{ color: DTONE[g.dtone] }}>{g.delta}</span>}
                </div>
              </div>
              <span className="text-center font-mono text-[0.58rem] font-bold uppercase tracking-[0.12em] text-inksoft">{g.label}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
