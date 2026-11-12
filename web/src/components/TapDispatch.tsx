/**
 * The Tap Dispatch — the round in review as an editorial newspaper (design: "Map · Review"). A masthead,
 * the firm's own private notices in a "For your house" box (only this firm is sent them — engine
 * visibility.ts), a lead story beside the standings, then sections → groups → stories (11-09, Devin's
 * review): same-kind moves fold into one compact line with team chips ("New markets entered: Switchback +
 * Iron Kettle → Harbor City · Cobblestone → Cedar Falls"); everything else keeps its own headline. Items
 * that name your house are flagged and float to the top of their section. Pure presentation over the
 * already-filtered event list — no new engine data.
 */
import { Fragment, useMemo } from "react";
import type { GameView } from "../game/controller.js";
import type { EventKind } from "./EventModal.js";
import { FIRM_NEWS, groupDispatch, type DispatchGroup } from "./eventFeed.js";
import { firmColor } from "../lib/teamColors.js";
import { MARKET_META, fmt } from "../labels.js";
import { tankUnitsOf } from "../lib/moneyCheck.js";

const SECTIONS: { kind: EventKind; glyph: string; label: string; accent: string }[] = [
  { kind: "shock", glyph: "⚠", label: "Disruptions", accent: "var(--color-brick)" },
  { kind: "market", glyph: "◈", label: "Market shifts", accent: "var(--color-copperdeep)" },
  { kind: "regulatory", glyph: "§", label: "Regulatory & financial", accent: "var(--color-copperdeep)" },
  { kind: "opportunity", glyph: "✦", label: "Moves & openings", accent: "var(--color-hop)" },
  { kind: "info", glyph: "ℹ", label: "Notices", accent: "var(--color-inksoft)" },
];
const LEAD_LABEL: Record<EventKind, string> = { shock: "Disruption", market: "Market shift", regulatory: "Regulatory", opportunity: "Opening", info: "Notice" };
const roman = (n: number): string => {
  const m: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let s = ""; let x = n;
  for (const [v, sy] of m) while (x >= v) { s += sy; x -= v; }
  return s || "—";
};

export function TapDispatch({ view, round }: { view: GameView; round: number }) {
  const youName = view.names[view.own.id] ?? "";
  // 11-09 (Devin): a hierarchy — section → group → one compact line per destination or house, with team chips.
  const { groups, singles } = useMemo(() => groupDispatch(view.events, youName, { tankUnits: tankUnitsOf(view) }), [view, youName]);
  const idByName = useMemo(() => new Map(Object.entries(view.names).map(([id, n]) => [n, id] as const)), [view.names]);
  // The firm's own notices (orders cut, the bank's answer…) reach only this firm (engine visibility.ts): they get
  // their own box instead of leading the paper as a market "Disruption" (playtest 11-06).
  const own = singles.filter((e) => e.mine && FIRM_NEWS.has(e.title));
  const pub = singles.filter((e) => !own.includes(e));
  const leadEvent = pub.find((e) => e.kind === "shock") ?? pub.find((e) => e.kind === "market") ?? pub[0] ?? null;
  const leadGroup = leadEvent ? null : [...groups].sort((a, b) => b.count - a.count)[0] ?? null;
  const sections = useMemo(
    () => SECTIONS.map((s) => ({
      ...s,
      groups: groups.filter((g) => g.kind === s.kind && g !== leadGroup).sort((a, b) => Number(b.mine) - Number(a.mine)),
      items: pub.filter((e) => e.kind === s.kind && e !== leadEvent).sort((a, b) => Number(!!b.mine) - Number(!!a.mine)),
    })).filter((s) => s.groups.length + s.items.length > 0),
    [groups, pub, leadEvent, leadGroup],
  );
  const homeCity = view.markets.find((m) => m.kind === "home");
  const edition = homeCity ? MARKET_META[homeCity.id]?.city ?? homeCity.label : "Front Range";
  const stories = groups.length + pub.length + own.length;
  const youMentions = groups.filter((g) => g.mine).length + pub.filter((e) => e.mine).length + own.length;

  const Chip = ({ name }: { name: string }) => {
    const you = !!youName && name === youName, id = idByName.get(name);
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap font-semibold" style={{ color: you ? "var(--color-copperdeep)" : "var(--color-ink)" }}>
        <i className="inline-block h-2 w-2 flex-none rounded-full" style={{ background: id ? firmColor(id) : "var(--color-faint)" }} />{you ? "You" : name}
      </span>
    );
  };
  const Lines = ({ g }: { g: DispatchGroup }) => (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {g.lines.map((l, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-faint">·</span>}
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            {l.firms.map((f, j) => <Fragment key={f}>{j > 0 && <span className="text-inksoft">+</span>}<Chip name={f} /></Fragment>)}
            <span className="text-ink/80">{l.text.startsWith("→") ? l.text : `· ${l.text}`}</span>
          </span>
        </Fragment>
      ))}
    </div>
  );

  return (
    <div className="mx-auto max-w-[880px] overflow-x-hidden px-1 py-2 [overflow-wrap:anywhere]">
      {/* masthead */}
      <div className="border-b-[3px] border-double border-ink pb-3 text-center">
        <div className="flex justify-between font-mono text-[0.55rem] uppercase tracking-[0.1em] text-inksoft">
          <span>Vol. {roman(round)} · Round {round}</span>
          <span className="hidden sm:inline">The Tap Dispatch</span>
          <span>{edition} Edition</span>
        </div>
        <div className="display my-1 text-[2.4rem] font-black uppercase leading-[0.9] text-ink sm:text-[3.4rem]">The Tap Dispatch</div>
        <div className="font-body text-xs italic text-inksoft">
          {stories ? `${stories} ${stories === 1 ? "story" : "stories"} from a market on the move${youMentions ? ` — ${youMentions} involve${youMentions === 1 ? "s" : ""} your house.` : "."}` : "A quiet round on the Front Range."}
        </div>
      </div>

      {/* the firm's own notices — private, so set apart from the market's news */}
      {own.length > 0 && (
        <div data-dw="dispatch-own" className="mt-4 rounded-lg border border-copper px-3 py-2.5" style={{ background: "color-mix(in srgb, var(--color-copper) 7%, transparent)" }}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="display text-sm font-extrabold uppercase tracking-[0.04em] text-ink">For your house</span>
            <span className="font-mono text-[0.55rem] uppercase tracking-wide text-inksoft">only you see these</span>
          </div>
          {own.map((e) => (
            <div key={e.id} className="mb-1.5 text-[0.8rem] leading-snug last:mb-0"><span className="font-bold text-ink">{e.title}.</span>{" "}<span className="text-ink/85">{e.body}</span></div>
          ))}
        </div>
      )}

      {/* lead story + standings */}
      <div className="grid grid-cols-1 gap-6 border-b border-line2 py-5 md:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0">
          {leadEvent ? (
            <>
              <span className="inline-block rounded-[3px] px-2 py-0.5 font-mono text-[0.5rem] font-bold uppercase tracking-[0.1em] text-paper" style={{ background: leadEvent.kind === "shock" ? "var(--color-brick)" : leadEvent.kind === "opportunity" ? "var(--color-hop)" : "var(--color-copperdeep)" }}>Lead · {LEAD_LABEL[leadEvent.kind]}</span>
              <div className="display my-2 text-3xl font-extrabold uppercase leading-[0.98] text-ink">{leadEvent.title}</div>
              <div className="font-body text-justify text-sm leading-relaxed text-ink/90">{leadEvent.body}</div>
            </>
          ) : leadGroup ? (
            <>
              <span className="inline-block rounded-[3px] px-2 py-0.5 font-mono text-[0.5rem] font-bold uppercase tracking-[0.1em] text-paper" style={{ background: leadGroup.kind === "opportunity" ? "var(--color-hop)" : "var(--color-copperdeep)" }}>Lead · {LEAD_LABEL[leadGroup.kind]}</span>
              <div className="display my-2 text-3xl font-extrabold uppercase leading-[0.98] text-ink">{leadGroup.title}</div>
              <div className="text-sm leading-relaxed"><Lines g={leadGroup} /></div>
            </>
          ) : (
            <>
              <span className="inline-block rounded-[3px] bg-hop px-2 py-0.5 font-mono text-[0.5rem] font-bold uppercase tracking-[0.1em] text-paper">Lead · Steady</span>
              <div className="display my-2 text-3xl font-extrabold uppercase leading-[0.98] text-ink">A Quiet Round In The Valley</div>
              <div className="font-body text-justify text-sm leading-relaxed text-ink/90">No shocks and no big moves: every house held its ground this round.</div>
            </>
          )}
        </div>
        <div className="min-w-0 md:border-l md:border-line2 md:pl-5">
          <div className="mb-1.5 font-mono text-[0.55rem] uppercase tracking-[0.1em] text-copperdeep">Standings · after R{round}</div>
          {view.standings.map((r, i) => (
            <div key={r.firm_id} className="flex items-center gap-2 border-b border-line py-1.5 last:border-0">
              <span className="w-4 font-mono text-[0.7rem] font-bold text-inksoft">{i + 1}</span>
              <span className="h-2.5 w-2.5 flex-none rounded-sm" style={{ background: firmColor(r.firm_id), border: r.isYou ? "1.5px solid #fff" : undefined, boxShadow: r.isYou ? `0 0 0 1px ${firmColor(r.firm_id)}` : undefined }} />
              <span className="display flex-1 truncate text-sm font-bold uppercase tracking-wide" style={{ color: r.isYou ? "var(--color-copperdeep)" : "var(--color-ink)" }}>{r.isYou ? `${r.name} (you)` : r.name}</span>
              <span className="font-mono text-[0.7rem] font-bold text-ink">{fmt.num(r.score, 1)}</span>
              {r.status !== "active" && <span className="font-mono text-[0.5rem] uppercase text-brick">out</span>}
            </div>
          ))}
        </div>
      </div>

      {/* sections → groups (one compact line per destination or house) → single stories */}
      {sections.length > 0 && (
        <div className="pt-4 [column-count:1] [column-gap:1.6rem] md:[column-count:2]">
          {sections.map((sec) => (
            <div key={sec.kind} className="mb-5 [break-inside:avoid]">
              <div className="mb-2 flex items-center gap-2 border-b-2 border-ink pb-1">
                <span style={{ color: sec.accent }}>{sec.glyph}</span>
                <span className="display text-sm font-extrabold uppercase tracking-[0.04em] text-ink">{sec.label}</span>
                <span className="flex-1" />
                <span className="font-mono text-[0.55rem] text-inksoft">{sec.groups.length + sec.items.length}</span>
              </div>
              {sec.groups.map((g) => (
                <div key={g.id} data-dw-group={g.id} className={`mb-2.5 text-[0.8rem] leading-snug ${g.mine ? "border-l-2 border-copper pl-2" : ""}`}>
                  <span className="font-bold text-ink">{g.title}</span>
                  <Lines g={g} />
                </div>
              ))}
              {sec.items.map((e) => (
                <div key={e.id} className={`mb-2.5 text-[0.8rem] leading-snug ${e.mine ? "border-l-2 border-copper pl-2" : ""}`}>
                  {e.title && <><span className="font-bold text-ink">{e.title}.</span>{" "}</>}<span className="text-ink/80">{e.body}</span>
                  {(e.count ?? 1) > 1 && <span className="ml-1.5 align-middle font-mono text-[0.55rem] font-bold text-inksoft">×{e.count}</span>}
                  {e.mine && <span className="ml-1.5 rounded-full border border-copper px-1.5 align-middle font-mono text-[0.5rem] font-bold uppercase text-copperdeep">you</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
