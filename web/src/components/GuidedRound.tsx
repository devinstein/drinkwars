/**
 * The guided first round (11-16; F26 post-mortems: 3 of the 4 teams that wrote one asked to be walked through a
 * round before playing). A practice solo game on a fixed seed with the base levers, and coach marks that walk one
 * round desk by desk: read the market, set prices, tanks, money, the rail, Brew, then read the results. Each step
 * says what a panel SHOWS and where a decision goes; it never says what to choose (the 11-09 rule).
 *
 * Launch: the Lobby's "Learn the game" (App.tsx). Dismissible (Close / Escape), replayable (the Tour button in the
 * header), keyboard-reachable (the card takes focus at each step; ← → move, Escape closes). The video primer's script
 * (docs/onboarding/) follows the same path, so the two teach the same thing.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ConfigOverride } from "drinkwars-engine";

/** The practice game: the base levers, a fixed seed (every student sees the same opening), four short rounds,
 *  no forecast calls (one less thing on the first screen). */
export const GUIDED_OVERRIDE = { game: { n_rounds: 4, seed: 2027 }, classroom: { forecasts: { enabled: false } } } as unknown as ConfigOverride;
export const GUIDED_NAME = "Practice Brewery";

export type GuideDest = "decide" | "review";
export type GuideTab = "statements" | "operations" | "value" | "dispatch" | "trends" | "field";
export interface GuideStep {
  id: string;
  title: string;
  body: string;
  target?: string; // CSS selector of the panel the step points at (none = a centred card)
  at?: { dest: GuideDest; rtab?: GuideTab };
  closeResults?: boolean; // leave the results page first
  waitBrew?: boolean; // the student runs the round; the tour moves on when it resolves
}

export const GUIDED_STEPS: GuideStep[] = [
  { id: "welcome", title: "A guided first round", body: "This practice game walks you through one round, one panel at a time: what each panel shows and where each decision goes. You make every choice; the tour never picks for you. A round is one quarter of a year. The tour takes about ten minutes. Use Next and Back (or the arrow keys) to move. Close ends the tour; the Tour button at the top brings it back." },
  { id: "hud", title: "The instrument bar", body: "Round, cash, capacity and rank. Cash is what the brewery holds now. Capacity is how many drinks your tanks can brew this quarter. Rank appears once the first round has run.", target: "[data-dw=hud]", at: { dest: "decide" } },
  { id: "boardroom", title: "The Boardroom", body: "Four officers sum up the firm: the CEO covers the standings, the CMO demand, the COO operations and the CFO money. Each \"details\" link shows the numbers behind that summary. In a class game, each officer is a seat on your team.", target: "[data-dw=boardroom]", at: { dest: "decide" } },
  { id: "market", title: "The market", body: "The CMO reports how many shoppers the market has this quarter, by category. Your share of them shows after this round runs.", target: "[data-dw-brief=cmo]", at: { dest: "decide" } },
  { id: "prices", title: "Marketing desk: prices", body: "Set one price per drink in each category. The line under each box shows what a drink earns above its brewing cost. From round 2, rivals' prices from the last round appear next to each box.", target: "[data-dw=prices-card]", at: { dest: "decide" } },
  { id: "tanks", title: "Operations desk: tanks", body: "Tanks limit how many drinks you can brew. Tanks ordered here arrive next quarter; the card shows how many drinks they add and what an unused tank still costs. Tanks wear down a little each quarter. The allocation bar splits this quarter's tanks between the categories.", target: "[data-dw=tanks-card]", at: { dest: "decide" } },
  { id: "build", title: "Building the brewery", body: "Spending here builds stocks that last: recipe quality, brand, brewing operations (a lower cost per drink) and relationships with staff, investors and regulators. Each one grows over the quarters that follow and wears down without upkeep.", target: "[data-dw=build-card]", at: { dest: "decide" } },
  { id: "finance", title: "Finance desk: money in and out", body: "Borrow from the bank, sell shares to investors, repay debt or pay a dividend. Each has a limit, shown on the right. Debt costs interest every quarter.", target: "[data-dw=financing-card]", at: { dest: "decide" } },
  { id: "cash", title: "Cash & credit", body: "What you have to work with this quarter: cash on hand, what the bank will lend, what investors will put in, and the emergency overdraft. A firm that ends a quarter past the overdraft closes.", target: "[data-testid=cash-and-credit]", at: { dest: "decide" } },
  { id: "running", title: "Paid from sales", body: "Projected cash is what the plan leaves before any drink sells. Operating costs (overhead, tank upkeep, rent, staff) and interest come due whatever you sell. Break-even is how many drinks cover them at your prices.", target: "[data-testid=running-costs]", at: { dest: "decide" } },
  { id: "brew", title: "Run the round", body: "When your plan is set, press Brew & Resolve. If the plan spends more than cash and financing cover, a check lists what the round would cut before anything runs. The seven rivals decide at the same time. The tour continues after the round runs.", target: "[data-dw=commit-submit]", at: { dest: "decide" }, waitBrew: true },
  { id: "results", title: "The results page", body: "Where you finished, your net income and cash, and what happened in the market this round. Every number comes from a choice (yours or a rival's) or from the market itself.", target: "[data-dw=round-resolved]" },
  { id: "statements", title: "Statements & Ratios", body: "The income statement, balance sheet and cash flow for the quarter. Revenue minus the cost of the drinks sold is gross profit. Subtract operating costs to get operating income, then interest.", target: "[data-dw=review-panel]", at: { dest: "review", rtab: "statements" }, closeResults: true },
  { id: "value", title: "The value stick", body: "For each category: your price and your cost per drink, from your books. What shoppers would pay (WTP) differs from shopper to shopper and shows as a ? until you buy market research, which estimates it from a survey. WTS is what suppliers and staff need. The firm keeps price − cost.", target: "[data-dw=value-stick]", at: { dest: "review", rtab: "value" }, closeResults: true },
  { id: "dispatch", title: "The Dispatch", body: "The round's news: market events, rivals' public moves, and notices only your firm sees.", target: "[data-dw=review-panel]", at: { dest: "review", rtab: "dispatch" }, closeResults: true },
  { id: "done", title: "That's one round", body: "The rest of this practice game plays the same way: decide, brew, read the results. In a class game the desks split across a team (CEO, CMO, COO, CFO), each seat submits its own desk, and the round runs when the instructor locks it. Close the tour to keep playing.", closeResults: true },
];

const visible = (sel?: string): HTMLElement | null => {
  if (!sel) return null;
  for (const el of document.querySelectorAll<HTMLElement>(sel)) if (el.getClientRects().length > 0) return el;
  return null;
};

/** The coach card + a ring around the panel it explains. It never blocks the page: the ring passes clicks through
 *  and the card sits beside the panel, so the student can try the lever while reading about it. */
export function GuidedRound({ step, onStep, onClose, go, closeResults, roundsRun }: {
  step: number;
  onStep: (i: number) => void;
  onClose: () => void;
  go: (dest: GuideDest, rtab?: GuideTab) => void;
  closeResults: () => void;
  roundsRun: number; // resolved rounds so far: the Brew step waits for the first
}) {
  const s = GUIDED_STEPS[step];
  // What the card has to fit around, re-read on scroll, resize and a light timer (a popover opening, a panel mounting).
  const [lay, setLay] = useState<{ rect: DOMRect | null; dialogs: DOMRect[]; vw: number; vh: number; cardH: number }>(() => ({ rect: null, dialogs: [], vw: window.innerWidth, vh: window.innerHeight, cardH: 0 }));
  const card = useRef<HTMLDivElement>(null);
  const startRuns = useRef(roundsRun);
  const measure = useCallback(() => {
    const el = visible(s.target);
    // other open dialogs (an officer's popover, the submit check, a phone sheet) — never the panel being explained
    const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')]
      .filter((d) => d.getClientRects().length > 0 && !(el && (d === el || d.contains(el))))
      .map((d) => d.getBoundingClientRect());
    setLay({ rect: el ? el.getBoundingClientRect() : null, dialogs, vw: window.innerWidth, vh: window.innerHeight, cardH: card.current?.offsetHeight ?? 0 });
  }, [step]);

  // Arrive: take the student to the step's screen, then find the panel (it can mount a beat later) and bring it into view.
  useEffect(() => {
    // a Decide step also leaves the results page (the tour replayed from the Tour button while results were up walked under them)
    if (s.closeResults || s.at?.dest === "decide") closeResults();
    if (s.at) go(s.at.dest, s.at.rtab);
    if (s.waitBrew) startRuns.current = roundsRun;
    let tries = 0, live = true;
    const find = () => {
      if (!live) return;
      const el = visible(s.target);
      if (el) {
        if (window.innerWidth < 640) {
          // phone: the card is docked at the top, so the panel's top goes just below it, not under it
          const below = (card.current?.offsetHeight ?? 220) + 24;
          window.scrollBy({ top: el.getBoundingClientRect().top - below, behavior: "smooth" });
        } else el.scrollIntoView({ block: "center", behavior: "smooth" });
        window.setTimeout(() => live && measure(), 400);
      } else if (s.target && tries++ < 12) window.setTimeout(find, 120);
      else measure();
    };
    window.setTimeout(find, 60);
    card.current?.focus({ preventScroll: true });
    return () => { live = false; };
  }, [step]);
  // The Brew step moves on by itself once the round has run.
  useEffect(() => { if (s.waitBrew && roundsRun > startRuns.current) onStep(step + 1); }, [roundsRun]);
  // Follow the panel as the page scrolls or resizes, and notice popovers opening and closing.
  useLayoutEffect(() => {
    let raf = 0;
    const track = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    window.addEventListener("scroll", track, true); window.addEventListener("resize", track);
    const tick = window.setInterval(track, 250);
    return () => { cancelAnimationFrame(raf); window.clearInterval(tick); window.removeEventListener("scroll", track, true); window.removeEventListener("resize", track); };
  }, [step, measure]);

  const last = step === GUIDED_STEPS.length - 1;
  const next = useCallback(() => (last ? onClose() : onStep(step + 1)), [last, step, onClose, onStep]);
  const back = useCallback(() => step > 0 && onStep(step - 1), [step, onStep]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowRight" && !s.waitBrew) { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
  };

  // Place the card where it covers neither the panel it explains nor any open popover. Desktop: beside the panel
  // (the roomier side first), then under or over it, then a free corner. Phone: docked at the top (the commit
  // sheet owns the bottom); while a popover sheet is open it shrinks to one line so the two never stack.
  const { rect, dialogs, vw, vh } = lay;
  const W = 340, pad = 12, NAV = 64, H = lay.cardH || 230, phone = vw < 640;
  const full = !!rect && rect.width > vw * 0.8 && rect.height > vh * 0.8; // the results page: the panel is the screen
  const hits = (p: { left: number; top: number }, r: DOMRect) => !(p.left + W <= r.left || p.left >= r.right || p.top + H <= r.top || p.top >= r.bottom);
  const fits = (p: { left: number; top: number }) => p.left >= pad && p.left + W <= vw - pad && p.top >= NAV && p.top + H <= vh - pad;
  let pos: React.CSSProperties = { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  if (phone) pos = rect && !full && rect.top < H + 12 && window.scrollY < 8
    ? { left: 16, right: 16, bottom: "max(16px, env(safe-area-inset-bottom))" } // a panel at the very top of the page can't scroll below the card: dock at the bottom
    : { left: 16, right: 16, top: "max(12px, env(safe-area-inset-top))" };
  else {
    const avoid = [...(rect && !full ? [rect] : []), ...dialogs];
    const clampTop = (t: number) => Math.min(Math.max(NAV, t), vh - H - pad);
    const clampLeft = (l: number) => Math.min(Math.max(pad, l), vw - W - pad);
    const corners = [{ left: vw - W - 24, top: vh - H - 24 }, { left: 24, top: vh - H - 24 }, { left: vw - W - 24, top: NAV }, { left: 24, top: NAV }];
    const beside = rect && !full ? (() => {
      const right = { left: rect.right + pad, top: clampTop(rect.top) }, left = { left: rect.left - W - pad, top: clampTop(rect.top) };
      const below = { left: clampLeft(rect.left), top: rect.bottom + pad }, above = { left: clampLeft(rect.left), top: rect.top - H - pad };
      return vw - rect.right > rect.left ? [right, left, below, above] : [left, right, below, above];
    })() : [];
    const pick = [...beside, ...corners].find((p) => fits(p) && !avoid.some((r) => hits(p, r)))
      ?? corners.find((p) => !dialogs.some((r) => hits(p, r)))
      ?? (rect || dialogs.length ? corners[0] : null);
    if (pick) pos = { left: pick.left, top: pick.top };
  }
  const paused = phone && dialogs.length > 0;
  const waiting = !!s.waitBrew && roundsRun <= startRuns.current;
  return (
    <>
      {/* the ring sits under popovers (z-40/50), so an officer's popover opened mid-tour is never crossed by it */}
      {rect && !full && dialogs.length === 0 && <div aria-hidden className="pointer-events-none fixed z-[35] rounded-[16px]" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12, border: "2px solid var(--color-copper)", boxShadow: "0 0 0 4px color-mix(in srgb, var(--color-copper) 22%, transparent), 0 0 24px var(--glow-a, rgba(242,149,42,.35))" }} />}
      <div ref={card} role="dialog" aria-modal="false" aria-labelledby="guide-title" aria-describedby="guide-body" tabIndex={-1} onKeyDown={onKey} data-dw="guide-card"
        className="fixed z-[71] rounded-[14px] border border-line2 bg-panel p-4 shadow-xl outline-none focus-visible:ring-2 focus-visible:ring-copper" style={{ width: phone ? undefined : W, ...pos }}>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[0.58rem] font-bold uppercase tracking-[0.14em] text-copperdeep">Guided round · {step + 1} of {GUIDED_STEPS.length}</span>
          <button type="button" onClick={onClose} className="ml-auto font-mono text-[0.62rem] font-semibold uppercase tracking-wide text-inksoft hover:text-ink">Close</button>
        </div>
        <h2 id="guide-title" className={paused ? "sr-only" : "mt-1 text-[1.02rem] font-bold leading-snug text-ink"}>{s.title}</h2>
        {paused && <p className="mt-1 text-[0.78rem] text-inksoft">Paused while that panel is open. Close it to carry on.</p>}
        <p id="guide-body" className={paused ? "sr-only" : "mt-1 text-[0.82rem] leading-relaxed text-ink"}>{s.body}</p>
        <div className={paused ? "hidden" : "mt-3 flex items-center gap-2"}>
          <button type="button" onClick={back} disabled={step === 0} className="rounded-lg border border-line2 px-3 py-1.5 font-mono text-[0.62rem] font-bold uppercase tracking-wide text-inksoft disabled:opacity-40">Back</button>
          <div className="flex-1" aria-hidden>
            <div className="h-1 overflow-hidden rounded-full" style={{ background: "var(--well, var(--color-line))" }}><div className="h-full rounded-full bg-copper" style={{ width: `${((step + 1) / GUIDED_STEPS.length) * 100}%` }} /></div>
          </div>
          {waiting
            ? <><span role="status" className="font-mono text-[0.6rem] font-semibold uppercase tracking-wide text-copperdeep">Waiting for Brew…</span><button type="button" onClick={() => onStep(step + 1)} className="font-mono text-[0.6rem] text-inksoft underline hover:text-ink">skip</button></>
            : <button type="button" onClick={next} className="tt-btn tt-btn--go px-4 py-1.5 text-[0.66rem]">{last ? "Finish" : "Next"}</button>}
        </div>
      </div>
    </>
  );
}
