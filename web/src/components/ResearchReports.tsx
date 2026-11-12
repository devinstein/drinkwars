/**
 * 11-07 (Devin): market research as three reports in one bundle, at the precision real research delivers
 * (engine/research.ts): a retail scan (exact sales and shares, one round old), a consumer survey (perceived
 * quality and brand as ranges, first choice, an NPS-style score with its trend) and an analyst brief (cost and
 * capacity ranges, a financial-health band, staff). Click a brewery for its dossier.
 */
import type { ReactNode } from "react";
import type { ResearchView } from "drinkwars-engine";
import type { GameView } from "../game/controller.js";
import { SEG_LABEL, fmt, marketName } from "../labels.js";
import { firmColor } from "../lib/teamColors.js";
import { Card, Eyebrow } from "./ui.js";
import { InfoDot } from "./InfoDot.js";
import { Sparkline } from "./Sparkline.js";

const seg = (id: string) => (SEG_LABEL[id] ?? id).split(" ")[0];
const k = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e4 ? `${Math.round(n / 1e3)}k` : fmt.int(n));
const pts = (d: number | null) => (d == null ? null : Math.abs(d) < 0.0005 ? { t: "±0", c: "var(--color-inksoft)" } : { t: `${d > 0 ? "▲" : "▼"}${Math.abs(d * 100).toFixed(1)}`, c: d > 0 ? "var(--color-hop)" : "var(--color-brick)" });
export const HEALTH: Record<string, { label: string; c: string }> = {
  strong: { label: "Strong", c: "var(--color-hop)" }, steady: { label: "Steady", c: "var(--color-aero)" },
  stretched: { label: "Stretched", c: "var(--color-copper)" }, distressed: { label: "Distressed", c: "var(--color-brick)" },
};
export const npsColor = (n: number | null) => (n == null ? "var(--color-inksoft)" : n >= 30 ? "var(--color-hop)" : n >= 0 ? "var(--color-copper)" : "var(--color-brick)");
export const npsText = (n: number | null) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n}`);

function Brewery({ row, onInspect }: { row: { firm_id: string; name: string; isYou: boolean }; onInspect?: (id: string) => void }) {
  const inner = <><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: firmColor(row.firm_id) }} /><span className={`truncate ${row.isYou ? "font-bold text-copperdeep" : "text-ink"}`}>{row.isYou ? `${row.name} (you)` : row.name}</span></>;
  return onInspect && !row.isYou
    ? <button type="button" onClick={() => onInspect(row.firm_id)} title="Open dossier" className="flex min-w-0 items-center gap-2 text-left hover:underline">{inner}</button>
    : <span className="flex min-w-0 items-center gap-2">{inner}</span>;
}
/** A range as text plus a bar on a shared scale. */
function RangeCell({ r, max, fmtv = (n: number) => n.toFixed(0), exact }: { r: [number, number]; max: number; fmtv?: (n: number) => string; exact?: boolean }) {
  const m = max > 0 ? max : 1;
  return (
    <div className="grid gap-1">
      <span className="tnum whitespace-nowrap">{exact || Math.abs(r[1] - r[0]) < 1e-9 ? fmtv(r[0]) : `${fmtv(r[0])}–${fmtv(r[1])}`}</span>
      <span className="relative block h-[5px] w-24 rounded-full" style={{ background: "var(--well)" }}>
        <span className="absolute top-0 h-full rounded-full" style={{ left: `${Math.min(100, (r[0] / m) * 100)}%`, width: `${Math.max(2, Math.min(100, ((r[1] - r[0]) / m) * 100))}%`, background: "var(--color-copper)", boxShadow: "0 0 6px var(--glow-a)" }} />
      </span>
    </div>
  );
}
const Th = ({ children, right }: { children?: ReactNode; right?: boolean }) => <th className={`py-1.5 pr-3 font-mono text-[0.58rem] font-bold uppercase tracking-[0.1em] text-inksoft ${right ? "text-right" : "text-left"}`}>{children}</th>;
const Source = ({ children }: { children: ReactNode }) => <div className="mt-2 text-[0.68rem] text-faint">{children}</div>;

export function ResearchReports({ view, onInspect }: { view: GameView; onInspect?: (firmId: string) => void }) {
  const r: ResearchView | null | undefined = view.research;
  if (!r) return null;
  const n = r.round + 1;
  const cats = view.segments.filter((s) => s.active).map((s) => s.id);
  const order = (id: string) => (r.retail.find((x) => x.firm_id === id)?.share ?? 0);
  const sortRows = <T extends { firm_id: string; isYou: boolean }>(rows: T[]) => [...rows].sort((a, b) => order(b.firm_id) - order(a.firm_id));
  const qMax = Math.max(...r.survey.map((x) => x.quality[1]), 1), bMax = Math.max(...r.survey.map((x) => x.brand[1]), 1);
  const capMax = Math.max(...r.analyst.map((x) => x.capacity[1]), 1);

  return (
    <div className="grid gap-4" data-dw="research-reports">
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-center gap-1.5"><Eyebrow>Retail scan · round {n}</Eyebrow>
            <InfoDot title="Retail scan">Every brewery's drinks sold and its share of each category's sales, from store and distributor data. Exact, but one round old. ▲▼ is the change in share, in points, from the round before. Sold out means it turned shoppers away.</InfoDot></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[0.8rem]">
            <thead><tr className="border-b border-line"><Th>Brewery</Th>{cats.map((c) => <Th key={c} right>{seg(c)} · sold · share</Th>)}<Th right>All drinks</Th></tr></thead>
            <tbody className="tnum">
              {sortRows(r.retail).map((x) => (
                <tr key={x.firm_id} className={`border-t border-line align-top ${x.isYou ? "bg-panel2" : ""}`}>
                  <td className="py-1.5 pr-3"><Brewery row={x} onInspect={onInspect} />
                    {x.byMarket && <div className="mt-0.5 text-[0.66rem] text-inksoft">{Object.entries(x.byMarket).sort((a, b) => b[1] - a[1]).map(([id, q]) => `${marketName(id)} ${k(q)}`).join(" · ")}</div>}</td>
                  {cats.map((c) => { const s = x.bySeg[c]; const d = pts(s?.dShare ?? null); return (
                    <td key={c} className="py-1.5 pr-3 text-right">{s ? <>
                      <div className="text-ink">{k(s.sold)} · {fmt.pct(s.share)}{d && <span className="ml-1 text-[0.68rem]" style={{ color: d.c }}>{d.t}</span>}</div>
                      {s.soldOut && <span className="rounded-full px-1.5 font-mono text-[0.55rem] font-bold uppercase" style={{ color: "var(--color-brick)", background: "var(--wire-redbg)" }}>sold out</span>}
                    </> : <span className="text-faint">—</span>}</td>
                  ); })}
                  <td className="py-1.5 text-right"><b className="text-ink">{fmt.pct(x.share)}</b>{(() => { const d = pts(x.dShare); return d ? <span className="ml-1 text-[0.68rem]" style={{ color: d.c }}>{d.t}</span> : null; })()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Source>Store and distributor sales data · exact · one round old</Source>
      </Card>

      <Card>
        <div className="flex items-center gap-1.5"><Eyebrow>Consumer survey · round {n}</Eyebrow>
          <InfoDot title="Consumer survey">A poll of drinkers. Quality and brand are what shoppers perceive, shown as ranges because surveys have error (the true value lands inside about nine times in ten). First choice is the share of each category's shoppers who picked the brewery first. The NPS-style score runs from −100 to +100: the share of a brewery's customers who would recommend it minus the share who would not. It rises with better value for the price than the field; customers who only bought it because their first choice sold out are lukewarm. Shoppers a brewery turned away aren't its customers, so sell-outs show in the retail scan instead.</InfoDot></div>
        <div className="overflow-x-auto">
          <table className="w-full text-[0.8rem]">
            <thead><tr className="border-b border-line"><Th>Brewery</Th><Th>Perceived quality</Th><Th>Perceived brand</Th><Th>First choice</Th><Th right>NPS-style score</Th></tr></thead>
            <tbody>
              {sortRows(r.survey).map((x) => {
                const trend = x.npsTrend.filter((v): v is number => v != null);
                const prev = x.npsTrend.length > 1 ? x.npsTrend[x.npsTrend.length - 2] : null;
                const d = x.nps != null && prev != null ? x.nps - prev : null;
                return (
                  <tr key={x.firm_id} className={`border-t border-line align-top ${x.isYou ? "bg-panel2" : ""}`}>
                    <td className="py-1.5 pr-3"><Brewery row={x} onInspect={onInspect} /></td>
                    <td className="py-1.5 pr-3"><RangeCell r={x.quality} max={qMax} /></td>
                    <td className="py-1.5 pr-3"><RangeCell r={x.brand} max={bMax} /></td>
                    <td className="tnum py-1.5 pr-3 text-[0.74rem] text-ink">{Object.entries(x.firstChoice).map(([c, v]) => `${seg(c)} ${fmt.pct(v)}`).join(" · ") || "—"}</td>
                    <td className="py-1.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {trend.length > 1 && <Sparkline values={trend} width={64} height={18} color={npsColor(x.nps)} />}
                        <b className="tnum text-[1rem]" style={{ color: npsColor(x.nps) }}>{npsText(x.nps)}</b>
                      </div>
                      {d != null && <div className="tnum text-[0.66rem]" style={{ color: d > 0 ? "var(--color-hop)" : d < 0 ? "var(--color-brick)" : "var(--color-inksoft)" }}>{d === 0 ? "no change" : `${d > 0 ? "▲" : "▼"}${Math.abs(d)} vs round ${n - 1}`}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Source>Brand-tracking poll of drinkers · quality and brand ±survey error · score trend across the season</Source>
      </Card>

      <Card>
        <div className="flex items-center gap-1.5"><Eyebrow>Analyst brief · round {n}</Eyebrow>
          <InfoDot title="Analyst brief">Industry analysts' estimates, from public filings, credit reports and hiring. Unit cost and capacity are ranges. Financial health is a credit-report style band from leverage, interest cover and cash, in place of a rival's books, which no research firm can sell you. Your own row is exact.</InfoDot></div>
        <div className="overflow-x-auto">
          <table className="w-full text-[0.8rem]">
            <thead><tr className="border-b border-line"><Th>Brewery</Th><Th>Unit cost</Th><Th>Capacity · drinks/rd</Th><Th>Financial health</Th><Th right>Staff</Th></tr></thead>
            <tbody>
              {sortRows(r.analyst).map((x) => (
                <tr key={x.firm_id} className={`border-t border-line align-top ${x.isYou ? "bg-panel2" : ""}`}>
                  <td className="py-1.5 pr-3"><Brewery row={x} onInspect={onInspect} /></td>
                  <td className="tnum py-1.5 pr-3 whitespace-nowrap text-ink">{x.unitCost ? (Math.abs(x.unitCost[1] - x.unitCost[0]) < 1e-9 ? fmt.price(x.unitCost[0]) : `${fmt.price(x.unitCost[0])}–${fmt.price(x.unitCost[1])}`) : "—"}</td>
                  <td className="py-1.5 pr-3"><RangeCell r={x.capacity} max={capMax} fmtv={k} exact={x.isYou} /></td>
                  <td className="py-1.5 pr-3"><span className="rounded-full px-2 py-0.5 font-mono text-[0.6rem] font-bold uppercase tracking-wide" style={{ color: HEALTH[x.health].c, background: `color-mix(in srgb, ${HEALTH[x.health].c} 14%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${HEALTH[x.health].c} 40%, transparent)` }}>{HEALTH[x.health].label}</span></td>
                  <td className="py-1.5 text-right text-[0.74rem] text-ink">{x.headcount != null ? <span className="tnum">{x.headcount}</span> : "—"}{x.keyHires.length > 0 && <div className="text-[0.66rem] text-inksoft">{x.keyHires.map((h) => h.replace(/_/g, " ")).join(" · ")}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Source>Analysts' estimates · ranges hold the true figure about nine times in ten · cash, debt and profit are never sold</Source>
      </Card>
    </div>
  );
}
