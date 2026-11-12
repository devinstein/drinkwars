import { useRef, useState, type ReactNode } from "react";
import type { BriefingData, RoleBriefing } from "drinkwars-engine";
import type { GameView } from "../game/controller.js";
import { Card, Eyebrow } from "./ui.js";
import { InfoDot } from "./InfoDot.js";
import { AnchoredPopover } from "./AnchoredPopover.js";
import { Sparkline } from "./Sparkline.js";
import { SEG_LABEL, fmt } from "../labels.js";
import { firmColor } from "../lib/teamColors.js";
import { SEAT_INK, seatColor } from "../lib/seatColors.js";

/** Where a seat's popover can send you for the full picture (a Review tab). */
export type ReviewLink = "statements" | "operations" | "trends" | "field";

type Role = RoleBriefing["role"];
const ORDER: Role[] = ["ceo", "cmo", "coo", "cfo"]; // the desks' order (deskMeta)
const TOPIC: Record<Role, string> = { cfo: "Capital", cmo: "Demand", coo: "Operations", ceo: "The field" };
const segName = (id: string) => SEG_LABEL[id] ?? id;
/** 444,411 → "444k"; 1,240,000 → "1.24M" (drinks, compact). */
const k = (n: number) => { const a = Math.abs(n); return a >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : a >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`; };
const lev = (n: number) => `${n.toFixed(2)}×`;

type Tone = "good" | "bad" | "note";
const TONE: Record<Tone, { glyph: string; color: string }> = { good: { glyph: "▲", color: "var(--color-hop)" }, bad: { glyph: "▼", color: "var(--color-brick)" }, note: { glyph: "●", color: "var(--color-copper)" } };
interface Fact { label: string; cells: { k?: string; v: string; me?: boolean }[]; est?: boolean }
interface Read { facts: Fact[]; verdicts: { tone: Tone; text: string; est?: boolean }[] }

/** The firm's own leverage (debt ÷ book equity), the same ratio the CFO brief uses. */
const ownLeverage = (view: GameView) => view.own.debt / Math.max(1e-6, view.own.paid_in_capital + view.own.retained_earnings);

/** 11-09 (Devin): the Boardroom in EVERY game. Each officer's glance is built from what the firm already
 *  knows — its own results and statements, public shelf prices, the standings. No estimate, no noise.
 *  Team roles (MOD-B05) layers each officer's noisy intel on top (`intel`): that noise is the module. */
function glance(role: Role, view: GameView): Read {
  const h = view.history.map((x) => x.own);
  const last = h[h.length - 1];
  switch (role) {
    case "ceo": {
      const rows = view.standings;
      const i = rows.findIndex((s) => s.isYou);
      if (i < 0 || !rows.length) return { facts: [], verdicts: [{ tone: "note", text: "Standings open after the first round" }] };
      const me = rows[i], above = i > 0 ? rows[i - 1] : null, below = rows[i + 1] ?? null;
      const gap = above ? above.score - me.score : below ? me.score - below.score : 0;
      return {
        facts: [
          { label: "Standing", cells: [{ v: `#${i + 1} of ${rows.length}`, me: true }, { k: "score", v: me.score.toFixed(2) }] },
          ...(above || below ? [{ label: above ? "Next up" : "Closest", cells: [{ v: (above ?? below)!.name }, { v: (above ?? below)!.score.toFixed(2) }] }] : []),
        ],
        verdicts: [above ? { tone: "note", text: `${gap.toFixed(2)} behind ${above.name}` } : { tone: "good", text: below ? `Leading by ${gap.toFixed(2)}` : "Last brewery standing" }],
      };
    }
    case "cmo": {
      const s = view.sizing;
      const pool = view.segments.filter((x) => x.active).reduce((a, x) => a + x.D, 0);
      const facts: Fact[] = s
        ? [{ label: "Market", cells: [{ k: "TAM", v: k(s.tam) }, { k: "SAM", v: k(s.sam) }, { k: "SOM", v: k(s.som), me: true }] }]
        : [{ label: "Market", cells: [{ v: `~${k(pool)} shoppers` }] }];
      // Shelf prices (public since 11-07): where the firm sits against each category's median.
      const pos = pricesByCategory(view).map((r) => {
        const me = r.prices.find((x) => x.you); if (!me) return null;
        const ps = r.prices.map((x) => x.p).sort((a, b) => a - b), med = ps[Math.floor((ps.length - 1) / 2)];
        return { seg: r.seg, rel: me.p > med * 1.03 ? "above" : me.p < med * 0.97 ? "below" : "at" };
      }).filter((x): x is { seg: string; rel: string } => !!x);
      return {
        facts,
        verdicts: pos.length ? [{ tone: "note", text: `Your price: ${pos.map((x) => `${x.rel} median in ${segName(x.seg)}`).join(" · ")}` }] : s ? [] : [{ tone: "note", text: "Your share opens after the first round" }],
      };
    }
    case "coo": {
      const uc = last?.unitCost ?? view.unitCostEst;
      const used = last && (last.capacity ?? 0) > 0 ? (last.unitsSold ?? 0) / (last.capacity ?? 1) : null;
      return {
        facts: [
          { label: "Unit cost", cells: [{ v: `${last?.unitCost ? "" : "~"}${fmt.price(uc)} a drink`, me: true }] },
          ...(used != null ? [{ label: "Tanks used", cells: [{ v: fmt.pct(Math.min(1, used)), me: true }] }] : []),
        ],
        verdicts: used == null ? [] : used >= 0.95 ? [{ tone: "bad", text: "Tanks ran full — some buyers may have been turned away" }] : used < 0.7 ? [{ tone: "note", text: `${fmt.pct(1 - used)} of the tanks stood idle` }] : [{ tone: "good", text: "Tanks well used" }],
      };
    }
    case "cfo": {
      const cov = last?.coverage;
      return {
        facts: [
          { label: "Leverage", cells: [{ k: "Yours", v: lev(ownLeverage(view)), me: true }] },
          { label: "Cash", cells: [{ v: fmt.money(view.own.cash), me: true }, ...(cov != null && cov <= 900 && view.own.debt > 0 ? [{ k: "coverage", v: `${cov.toFixed(1)}×` }] : [])] },
        ],
        verdicts: last ? [last.netIncome < 0 ? { tone: "bad", text: `Lost ${fmt.money(-last.netIncome)} last round` } : { tone: "good", text: `Earned ${fmt.money(last.netIncome)} last round` }] : [],
      };
    }
  }
}

/** MOD-B05's noisy intel for one officer (Team roles only), marked as an estimate. The COO's brief is exact
 *  since 11-07 and already in the glance, so the COO adds only the officer's own process read. */
function intel(b: RoleBriefing | undefined, view: GameView): Read | null {
  const d = b?.data as BriefingData | undefined;
  if (!d) return null;
  switch (d.role) {
    case "cfo": return {
      facts: [{ label: "Rivals", cells: [{ k: "leverage", v: `~${lev(d.rivalLeverage)}` }], est: true }],
      verdicts: [d.stretched ? { tone: "bad", text: "Most stretched balance sheet at the table", est: true } : { tone: "good", text: "Above-average balance sheet — room to borrow", est: true }],
    };
    case "cmo": return {
      facts: [{ label: "Next round", cells: d.nextDemand.map((x) => ({ k: segName(x.seg), v: `~${k(x.units)}` })), est: true }],
      verdicts: [
        ...(d.biggest && d.nextDemand.length > 1 ? [{ tone: "note" as Tone, text: `Biggest pool: ${segName(d.biggest)}`, est: true }] : []),
        ...(d.drift ? [{ tone: "note" as Tone, text: "Drinkers trending toward quality", est: true }] : []),
      ],
    };
    case "coo": return { facts: [], verdicts: [d.matureProcess ? { tone: "good", text: "Process paying off — yields above the field" } : { tone: "note", text: "Easy yield left — process spend cuts cost fastest" }] };
    case "ceo": return d.watch ? {
      facts: [{ label: "Watch", cells: [{ v: view.names[d.watch] ?? d.watch }, { v: `${d.posture ?? ""}${d.murky ? " · murky read" : ""}` }], est: true }],
      verdicts: [d.outscaled ? { tone: "bad", text: "Out-scales you — a volume fight is uphill", est: true } : { tone: "note", text: "Even on scale — position, don't out-spend", est: true }],
    } : null;
  }
}

/** The Boardroom: four officers, one glance each, every game (11-09). Under Team roles each officer
 *  also brings a noisy brief (MOD-B05) — rows marked "est." — and the team integrates the reads. */
export function Boardroom({ view, onOpen }: { view: GameView; onOpen?: (to: ReviewLink) => void }) {
  const intelOn = view.briefings.length > 0;
  return (
    <Card>
      <div className="flex items-center gap-1.5">
        <Eyebrow>Boardroom</Eyebrow>
        <InfoDot title="The Boardroom" align="right">
          {intelOn
            ? "Each officer reads the firm from your own results and what the whole market can see. Rows marked est. are that officer's estimate of what you can't see — they can be off. Tap an officer for the numbers."
            : "Each officer reads the firm from your own results and what the whole market can see. Tap an officer for the numbers behind the read."}
        </InfoDot>
      </div>
      <div className="grid gap-2">
        {ORDER.map((role) => <Brief key={role} role={role} b={view.briefings.find((x) => x.role === role)} view={view} onOpen={onOpen} />)}
      </div>
    </Card>
  );
}

function Brief({ role, b, view, onOpen }: { role: Role; b?: RoleBriefing; view: GameView; onOpen?: (to: ReviewLink) => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const g = glance(role, view);
  const x = intel(b, view);
  const facts = [...g.facts, ...(x?.facts ?? [])];
  const verdicts = [...g.verdicts, ...(x?.verdicts ?? [])];
  const color = seatColor(role);
  return (
    <div ref={stage} className="border-b border-line pb-2 last:border-0 last:pb-0" data-dw-brief={role}>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="group flex w-full items-center gap-2 rounded-md py-0.5 text-left">
        <span className="rounded-[5px] px-1.5 py-0.5 font-mono text-[0.6rem] font-extrabold tracking-[0.08em]" style={{ background: color, color: SEAT_INK }}>{role.toUpperCase()}</span>
        <span className="text-[0.72rem] font-bold uppercase tracking-[0.1em] text-inksoft group-hover:text-ink">{TOPIC[role]}</span>
        <span className="ml-auto font-mono text-[0.6rem] text-faint group-hover:text-copper">details ▸</span>
      </button>
      <div className="mt-1 grid gap-1">
        {facts.map((f) => (
          <div key={f.label} className="grid grid-cols-[5.6rem_minmax(0,1fr)] items-baseline gap-x-2 text-[0.76rem]">
            <span className="whitespace-nowrap text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-faint">{f.label}</span>
            <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5">
              {f.cells.map((c, i) => (
                <span key={i} className="tnum whitespace-nowrap">{c.k && <span className="text-inksoft">{c.k} </span>}<b className={c.me ? "text-copperdeep" : "text-ink"}>{c.v}</b></span>
              ))}
              {f.est && <Est />}
            </span>
          </div>
        ))}
        {verdicts.map((v) => (
          <div key={v.text} className="flex items-baseline gap-1.5 text-[0.74rem] leading-snug text-ink"><span className="text-[0.6rem]" style={{ color: TONE[v.tone].color }}>{TONE[v.tone].glyph}</span><span>{v.text}{v.est && <> <Est /></>}</span></div>
        ))}
      </div>
      {open && (
        <AnchoredPopover stage={stage} at={{ l: 50, t: 0 }} width={360} label={`${role.toUpperCase()} · ${TOPIC[role]}`} onClose={() => setOpen(false)}>
          <div className="flex items-center gap-2 pb-2">
            <span className="rounded-[5px] px-1.5 py-0.5 font-mono text-[0.62rem] font-extrabold tracking-[0.08em]" style={{ background: color, color: SEAT_INK }}>{role.toUpperCase()}</span>
            <span className="text-[0.78rem] font-bold uppercase tracking-[0.12em] text-ink">{TOPIC[role]}</span>
            <button type="button" onClick={() => setOpen(false)} className="ml-auto font-mono text-[0.7rem] text-inksoft hover:text-ink" aria-label="Close">✕</button>
          </div>
          {role === "cmo" && <CmoDetail b={b} view={view} />}
          {role === "coo" && <CooDetail view={view} />}
          {role === "cfo" && <CfoDetail b={b} view={view} />}
          {role === "ceo" && <CeoDetail b={b} view={view} />}
          {onOpen && (
            <button type="button" onClick={() => { setOpen(false); onOpen(LINK[role].to); }} className="mt-3 w-full rounded-lg border border-line2 px-3 py-1.5 text-left font-mono text-[0.64rem] font-bold uppercase tracking-wide text-copperdeep hover:border-copper">
              {LINK[role].label} →
            </button>
          )}
        </AnchoredPopover>
      )}
    </div>
  );
}

/** "est." — the officer's estimate (Team roles), not a fact the firm holds. */
const Est = () => <span title="The officer's estimate — it can be off" className="rounded-full border border-line2 px-1 font-mono text-[0.52rem] font-bold uppercase tracking-wide text-faint">est.</span>;

const LINK: Record<RoleBriefing["role"], { to: ReviewLink; label: string }> = {
  cmo: { to: "operations", label: "Market size & demand in Review" },
  coo: { to: "statements", label: "Income statement in Review" },
  cfo: { to: "statements", label: "Balance sheet & ratios in Review" },
  ceo: { to: "field", label: "Field & Intel in Review" },
};

const H = ({ children }: { children: ReactNode }) => <div className="mb-1 mt-2 text-[0.62rem] font-bold uppercase tracking-[0.12em] text-inksoft first:mt-0">{children}</div>;
const Muted = ({ children }: { children: ReactNode }) => <div className="text-[0.68rem] leading-snug text-faint">{children}</div>;

/** A ring: the whole pool, with SAM (what you can reach) and SOM (what you won) as arcs from 12 o'clock. */
function Donut({ sam, som, label }: { sam: number; som: number; label: string }) {
  const a = Math.max(0, Math.min(1, sam)) * 360, b = Math.max(0, Math.min(1, som)) * 360;
  return (
    <div className="relative grid h-[68px] w-[68px] flex-none place-items-center rounded-full" style={{ background: `conic-gradient(var(--color-copper) 0 ${b}deg, color-mix(in srgb, var(--color-gold) 55%, transparent) ${b}deg ${a}deg, var(--well) ${a}deg 360deg)` }}>
      <div className="grid h-[48px] w-[48px] place-items-center rounded-full bg-panel text-[0.74rem] font-bold tnum text-ink">{label}</div>
    </div>
  );
}

function CmoDetail({ b, view }: { b?: RoleBriefing; view: GameView }) {
  const d = b?.data?.role === "cmo" ? b.data : null;
  const cats = view.history[view.history.length - 1]?.own.categories ?? {};
  const s = view.sizing;
  const known = Object.keys(cats).length > 0;
  const samShare = s && s.tam > 0 ? s.sam / s.tam : 1; // geography: the share of shoppers in markets you sell in
  const field = pricesByCategory(view);
  // Team roles: the CMO's noisy next-round read. Otherwise the market's own size by category (no estimate).
  const pools = d ? d.nextDemand : view.segments.filter((x) => x.active).map((x) => ({ seg: x.id, units: x.D }));
  return (
    <div>
      <H>{d ? "Next round · drinks by category (est.)" : "Market · shoppers a round, by category"}</H>
      {pools.length ? (
        <div className="grid gap-2">
          {pools.map((x) => {
            const stocked = !known || (cats[x.seg]?.wanted ?? 0) > 0 || (cats[x.seg]?.sold ?? 0) > 0; // before round 1 resolves, every open category is stocked
            const share = cats[x.seg]?.share ?? 0;
            const sam = stocked ? samShare : 0;
            const ap = d ? "~" : "";
            return (
              <div key={x.seg} className="flex items-center gap-3">
                <Donut sam={sam} som={Math.min(sam, share)} label={share > 0 ? fmt.pct(share) : "—"} />
                <div className="min-w-0 text-[0.74rem] leading-snug">
                  <div className="font-bold text-ink">{segName(x.seg)}</div>
                  <div className="tnum"><span className="text-inksoft">TAM</span> {ap}{k(x.units)} · <span className="text-inksoft">SAM</span> {ap}{k(x.units * sam)}</div>
                  <div className="tnum"><span className="text-inksoft">Your share last round</span> {share > 0 ? <b className="text-copperdeep">{fmt.pct(share)} → {ap}{k(x.units * share)}</b> : "—"}</div>
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap gap-x-3 text-[0.64rem] text-inksoft">
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: "var(--well)", boxShadow: "inset 0 0 0 1px var(--color-line2)" }} />TAM · every shopper</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: "color-mix(in srgb, var(--color-gold) 55%, transparent)" }} />SAM · your markets</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-copper" />SOM · your share</span>
          </div>
          <Muted>{d ? "The CMO's estimate, with noise. " : ""}SAM counts the markets you sold in last quarter{s ? "" : " (one market: every shopper in a category you stock)"}.</Muted>
        </div>
      ) : <Muted>No open categories.</Muted>}
      {field.length > 0 && (<><H>Shelf prices last round</H><PriceLadders rows={field} /></>)}
    </div>
  );
}

/** Each category's shelf prices last round: every firm with a public (or researched) price, yours ringed. */
export function pricesByCategory(view: GameView): { seg: string; prices: { id: string; name: string; p: number; you: boolean }[] }[] {
  const segs = view.segments.filter((s) => s.active).map((s) => s.id);
  return segs.map((seg) => ({
    seg,
    prices: view.firms.filter((f) => (f.priceBySeg?.[seg] ?? 0) > 0 && (f.isYou || f.status === "active")).map((f) => ({ id: f.firm_id, name: f.isYou ? "You" : f.name, p: f.priceBySeg[seg], you: f.isYou })),
  })).filter((r) => r.prices.length > 1);
}

export function PriceLadders({ rows }: { rows: ReturnType<typeof pricesByCategory> }) {
  return (
    <div className="grid gap-2.5">
      {rows.map((r) => {
        const ps = r.prices.map((x) => x.p);
        const lo = Math.min(...ps), hi = Math.max(...ps), span = hi - lo || 1;
        const sorted = [...ps].sort((a, b) => a - b);
        const med = sorted[Math.floor((sorted.length - 1) / 2)];
        const me = r.prices.find((x) => x.you);
        return (
          <div key={r.seg} className="text-[0.72rem]">
            <div className="flex items-baseline justify-between gap-2"><span className="font-bold text-ink">{segName(r.seg)}</span><span className="tnum text-inksoft">{fmt.price(lo)}–{fmt.price(hi)} · median {fmt.price(med)}{me ? <> · <b className="text-copperdeep">you {fmt.price(me.p)}</b></> : null}</span></div>
            <div className="relative mt-1.5 h-[14px]">
              <div className="tt-bar absolute inset-x-0 top-[5px]" style={{ height: 4 }} />
              {r.prices.map((x) => (
                <span key={x.id} title={`${x.name} · ${fmt.price(x.p)}`} className="absolute top-0 h-[14px] w-[14px] -translate-x-1/2 rounded-full" style={{ left: `${((x.p - lo) / span) * 92 + 4}%`, background: x.you ? "var(--color-copper)" : firmColor(x.id), boxShadow: x.you ? "0 0 0 2px var(--color-panel), 0 0 0 3.5px var(--color-copper), 0 0 10px var(--glow-a)" : "0 0 0 2px var(--color-panel)" }} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CooDetail({ view }: { view: GameView }) {
  const h = view.history.map((x) => x.own);
  const last = h[h.length - 1];
  const cats = Object.entries(last?.categories ?? {}).filter(([, c]) => c.price > 0);
  const uc = last?.unitCost ?? view.unitCostEst;
  const top = Math.max(...cats.map(([, c]) => c.price), uc, 0.01);
  const gm = h.filter((x) => (x.revenue ?? 0) > 0).map((x) => (x.gross ?? 0) / (x.revenue ?? 1));
  const ucs = h.map((x) => x.unitCost ?? 0).filter((x) => x > 0);
  return (
    <div>
      <H>Margin per drink · last round</H>
      {cats.length ? (
        <div className="grid gap-1.5">
          {cats.map(([seg, c]) => {
            const m = c.price - uc;
            return (
              <div key={seg} className="text-[0.72rem]">
                <div className="flex justify-between"><span className="font-bold text-ink">{segName(seg)}</span><span className="tnum text-inksoft">price {fmt.price(c.price)} · cost {fmt.price(uc)} · <b className={m >= 0 ? "text-hop" : "text-brick"}>{m >= 0 ? "+" : "−"}{fmt.price(Math.abs(m))}</b></span></div>
                <div className="mt-1 flex h-[8px] overflow-hidden rounded-full" style={{ background: "var(--well)" }}>
                  <span style={{ width: `${(Math.min(uc, c.price) / top) * 100}%`, background: "var(--color-faint)" }} />
                  {m > 0 && <span style={{ width: `${(m / top) * 100}%`, background: "var(--color-hop)", boxShadow: "0 0 8px var(--glow-ok)" }} />}
                </div>
              </div>
            );
          })}
          <div className="flex gap-3 text-[0.64rem] text-inksoft"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: "var(--color-faint)" }} />unit cost</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-hop" />margin</span></div>
        </div>
      ) : <Muted>Opens after the first round resolves. Unit cost now ~{fmt.price(uc)}.</Muted>}
      {(gm.length > 1 || ucs.length > 1) && (
        <>
          <H>Trend by round</H>
          <div className="grid gap-1 text-[0.72rem]">
            {ucs.length > 1 && <div className="flex items-center justify-between gap-2"><span className="text-inksoft">Unit cost <b className="tnum text-ink">{fmt.price(ucs[ucs.length - 1])}</b></span><Sparkline values={ucs} width={120} /></div>}
            {gm.length > 1 && <div className="flex items-center justify-between gap-2"><span className="text-inksoft">Gross margin <b className="tnum text-ink">{fmt.pct(gm[gm.length - 1])}</b></span><Sparkline values={gm} width={120} color="var(--color-hop)" /></div>}
          </div>
        </>
      )}
    </div>
  );
}

function CfoDetail({ b, view }: { b?: RoleBriefing; view: GameView }) {
  const d = b?.data?.role === "cfo" ? b.data : null;
  const h = view.history.map((x) => x.own);
  const bars = h.slice(-6);
  const top = Math.max(...bars.map((x) => Math.max(Math.abs(x.cash), Math.abs(x.netIncome))), 1);
  const cov = h.length ? h[h.length - 1].coverage : null;
  const mine = ownLeverage(view);
  // Rivals' leverage is private: only the CFO's noisy estimate (Team roles) shows it.
  const levRows = [...(d ? [{ l: "Rivals (avg, est.)", v: d.rivalLeverage, me: false }] : []), { l: "Yours", v: mine, me: true }];
  const levTop = Math.max(...levRows.map((x) => x.v), 0.5);
  return (
    <div>
      <H>Leverage · debt ÷ equity</H>
      {levRows.map((x) => (
        <div key={x.l} className="grid grid-cols-[7.5rem_minmax(0,1fr)_3rem] items-center gap-2 text-[0.72rem]">
          <span className="text-inksoft">{x.l}</span>
          <span className="h-[8px] overflow-hidden rounded-full" style={{ background: "var(--well)" }}><span className="block h-full rounded-full" style={{ width: `${Math.min(100, (x.v / levTop) * 100)}%`, background: x.me ? "var(--color-copper)" : "var(--color-faint)" }} /></span>
          <b className="tnum text-right text-ink">{lev(x.v)}</b>
        </div>
      ))}
      {cov != null && cov <= 900 && <div className="mt-1.5 text-[0.72rem] text-inksoft">Interest coverage last round <b className="tnum text-ink">{cov.toFixed(1)}×</b></div>}
      {bars.length > 0 && (
        <>
          <H>Cash &amp; net income · by round</H>
          <div className="flex h-[96px] items-end gap-2.5">
            {bars.map((x) => (
              <div key={x.round} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-[76px] w-full items-end justify-center gap-[3px]">
                  <span className="w-[42%] rounded-t-[3px]" style={{ height: `${(Math.max(0, x.cash) / top) * 100}%`, background: "var(--color-aero)" }} title={`Cash ${fmt.money(x.cash)}`} />
                  <span className="w-[42%] rounded-t-[3px]" style={{ height: `${(Math.abs(x.netIncome) / top) * 100}%`, background: x.netIncome < 0 ? "var(--color-brick)" : "var(--color-hop)" }} title={`Net income ${fmt.signed(x.netIncome)}`} />
                </div>
                <span className="font-mono text-[0.58rem] text-inksoft">R{x.round + 1}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-3 text-[0.64rem] text-inksoft"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-aero" />cash</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-hop" />net income</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-brick" />loss</span></div>
        </>
      )}
    </div>
  );
}

function CeoDetail({ b, view }: { b?: RoleBriefing; view: GameView }) {
  const d = b?.data?.role === "ceo" ? b.data : null;
  const rows = view.standings.slice(0, 8);
  const scores = rows.map((s) => s.score);
  const lo = Math.min(...scores, 0), hi = Math.max(...scores, 0.01), span = hi - lo || 1;
  return (
    <div>
      {d?.watch && <div className="text-[0.74rem] leading-snug"><span className="text-inksoft">One to watch</span> <b className="text-ink">{view.names[d.watch] ?? d.watch}</b> · {d.posture}{d.murky && <span className="text-faint"> (murky read)</span>}</div>}
      <H>Standings · scorecard</H>
      {rows.length ? (
        <div className="grid gap-1">
          {rows.map((s, i) => (
            <div key={s.firm_id} className="grid grid-cols-[1rem_minmax(0,7rem)_minmax(0,1fr)_2.8rem] items-center gap-2 text-[0.72rem]">
              <span className="tnum text-faint">{i + 1}</span>
              <span className={`truncate ${s.isYou ? "font-bold text-copperdeep" : s.firm_id === d?.watch ? "font-bold text-ink" : "text-ink"}`}>{s.isYou ? "You" : s.name}</span>
              <span className="h-[6px] overflow-hidden rounded-full" style={{ background: "var(--well)" }}><span className="block h-full rounded-full" style={{ width: `${((s.score - lo) / span) * 100}%`, background: s.isYou ? "var(--color-copper)" : firmColor(s.firm_id) }} /></span>
              <span className="tnum text-right text-inksoft">{s.score.toFixed(2)}</span>
            </div>
          ))}
        </div>
      ) : <Muted>Standings open after the first round.</Muted>}
    </div>
  );
}
