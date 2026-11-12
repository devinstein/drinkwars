/**
 * DW-077 the wire strip (design/round-ux-2026-10 §A, "after dismissal"): one row per event the student may
 * know about, directly under the header on EVERY tab. Design pass 2b (Control Room Glass): each row is an
 * alarm card — a glowing status dot, tag + title, the summary and "For your desk:", and when it's in effect —
 * on glass tinted with the event colour. No events → one "all clear" line with a green dot. Pure
 * presentation over `eventCopy()`; the takeover card is EventTakeover.tsx.
 */
import type { WireEvent } from "../lib/eventCopy.js";

const TONE = {
  red: { c: "var(--wire-red)", tint: "var(--wire-redbg)" },
  amber: { c: "var(--wire-amber)", tint: "var(--wire-amberbg)" },
} as const;

export function WireStrip({ events }: { events: WireEvent[] }) {
  if (!events.length) {
    return (
      <div className="flex items-center gap-2.5 px-1 py-0.5" data-wire="quiet">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: "var(--color-hop)", boxShadow: "0 0 10px var(--color-hop)" }} />
        <span className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.14em] text-inksoft">All clear<span className="hidden sm:inline"> · no market events this round</span></span>
      </div>
    );
  }
  return (
    <div className="grid gap-2" data-wire="rows">
      {events.map((e) => {
        const t = TONE[e.tone];
        return (
          <div key={`${e.key}:${e.phase}`} className="grid items-center gap-x-5 gap-y-1.5 rounded-[16px] px-4 py-3 sm:grid-cols-[minmax(11rem,auto)_minmax(0,1fr)_auto] sm:px-5"
            style={{ background: `linear-gradient(100deg, ${t.tint}, transparent 70%), var(--sheen), var(--glass)`, border: `1px solid color-mix(in srgb, ${t.c} 55%, transparent)`, boxShadow: "var(--gs)" }}>
            <div className="flex items-center gap-3">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: t.c, boxShadow: `0 0 0 5px color-mix(in srgb, ${t.c} 18%, transparent), 0 0 18px ${t.c}` }} />
              <div className="flex min-w-0 flex-col">
                <span className="font-mono text-[0.6rem] font-bold uppercase tracking-[0.14em]" style={{ color: t.c }}>{e.tag}</span>
                <span className="display text-[1.08rem] font-extrabold leading-tight text-ink">{e.title}</span>
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="hidden text-[0.92rem] leading-snug text-inksoft sm:block">{e.summary.charAt(0).toUpperCase() + e.summary.slice(1)}</span>
              <span className="text-[0.92rem] leading-snug text-ink"><b style={{ color: t.c }}><span className="hidden sm:inline">For your desk:</span><span className="sm:hidden">Your desk:</span></b> {e.short}</span>
            </div>
            <span className="hidden font-mono text-[0.64rem] font-semibold tracking-[0.1em] text-inksoft sm:block">IN EFFECT · {e.when}</span>
          </div>
        );
      })}
    </div>
  );
}
