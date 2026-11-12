import type { EventKind, GameEvent } from "./EventModal.js";
import { SEG_LABEL, marketName } from "../labels.js";

/** A segment id the engine left unset ("?", "(unset)", empty): a rebuild that named no category. */
const unsetSeg = (id: string): boolean => {
  const k = id.trim().toLowerCase();
  return !k || k === "?" || k === "(unset)";
};
/** Map a raw segment id (mass/niche/frontier) to its beverage label; tolerate the
 *  engine's "?"/"(unset)" placeholders so no code-style token reaches the player. */
const seg = (id: string): string => (unsetSeg(id) ? "a fresh focus" : SEG_LABEL[id.trim().toLowerCase()] ?? id);
/** ", now focused on Craft Premium", or nothing when a rebuild named no category. */
const focusOn = (id: string): string => (unsetSeg(id) ? "" : `, now focused on ${seg(id)}`);

/** Friendly names for shock type ids + their mechanical "kind", so a fired shock
 *  reads as prose instead of "water (cost_spike, mag 0.35, unannounced)". */
const SHOCK_LABEL: Record<string, string> = {
  water: "Water shortage",
  harvest: "Harvest failure",
  co2: "CO₂ & packaging squeeze",
  demand_slump: "Recession",
  craft_wave: "Festival season",
  health_shift: "Health & wellness shift",
  na_moment: "Non-alcoholic goes mainstream",
};
/** Past tense: the feed reports what the round just did. */
const SHOCK_KIND: Record<string, string> = {
  cost_spike: "brewing costs rose",
  capacity_hit: "brewing capacity fell",
  demand_drop: "demand fell",
  demand_boost: "demand rose",
  cash_hit: "cash fell",
};
/** The two demand shocks that strike one category name it (the event line carries no target). */
const SHOCK_WHAT: Record<string, string> = {
  health_shift: `${SEG_LABEL.mass} demand fell`,
  na_moment: `${SEG_LABEL.frontier} demand rose`,
};
const severity = (mag: number): string => (mag >= 0.3 ? "sharply" : mag >= 0.15 ? "moderately" : "mildly");
/** DW-075: the loyalty a departure took with it, from the event's optional suffix ("" when none). */
const LOYALTY_LOST = (quarters?: string, pct?: string): string =>
  quarters ? ` They had built ${quarters} quarter${quarters === "1" ? "" : "s"} of loyalty, which raised their contribution by ${pct}%. That is lost too.` : "";

/** Plain-language gloss for each contingent-clause trigger (MOD-A05). */
const CLAUSE_COND: Record<string, string> = {
  water_shock: "a water shortage hit",
  harvest_shock: "a harvest failure hit",
  capacity_shock: "a CO₂ and packaging squeeze hit",
  partner_distress: "a partner got into financial trouble",
  segment_emerges: "a new category opened",
};

/** Alliance names as the Alliances panel shows them, so no engine id ("formal supply_share") reaches the player. */
const PACT_FORM: Record<string, string> = { relational: "handshake deal", formal: "contract", collective: "guild" };
const PACT_KIND: Record<string, string> = { joint_marketing: "joint-marketing", capacity_coordination: "capacity-coordination", supply_share: "supply-sharing" };
const pactName = (form: string, template: string): string => `${PACT_KIND[template] ?? template.replace(/_/g, " ")} ${PACT_FORM[form] ?? "pact"}`;
/** The pact a raw alliance line names ("… formal supply_share (ag_3)") as "the supply-sharing contract", else "a pact". */
const pactIn = (raw: string): string => {
  const m = raw.match(/\b(relational|formal|collective)\s+([a-z_]+)\b/);
  return m ? `the ${pactName(m[1], m[2])}` : "a pact";
};
const capFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** What a shared industry fund (MOD-A02) does once it reaches its goal. */
const FUND_EFFECT: Record<string, string> = {
  "water commons": "It now softens water shortages.",
  "quality certification": "Shoppers now weigh quality more.",
  "regional marketing": "It now lifts demand.",
};
/** What a lobbied regulation (MOD-A09) changes, by its label, for the categories it covers. */
const REG_EFFECT: Record<string, (segs: string) => string> = {
  "quality standards": (s) => `shoppers in ${s} weigh quality more`,
  "advertising limits": (s) => `brand sways shoppers in ${s} less`,
  "craft promotion": (s) => `more shoppers buy ${s}`,
};

const titleCase = (s: string): string => s.replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Turn the engine's terse event strings (e.g. "SHOCK water: +35% unit cost",
 * "PR PLAY: Copper & Cask ran a viral label drop — brand buzz surges") into
 * framed, player-facing dispatches: a category, a headline, and clean prose with
 * the engine's raw "TAG:" prefix stripped. Firm ids were already substituted for
 * brewery names upstream; here we de-code the rest so a dispatch reads like a
 * newspaper line, not a log entry.
 *
 * 11-09 plain-language pass: past tense, short sentences, every term glossed or avoided, and no advice. A body may
 * state a game rule (what softens a hit, what wins a tie) but never what a player should do. A body that may be the
 * reader's own starts with the firm's name and avoids "its" for the firm, so the "You …" rewrite below reads right.
 */

interface Rule {
  test: RegExp;
  kind: EventKind;
  /** Static headline, or one derived from the match (e.g. shock type). */
  title: string | ((m: RegExpMatchArray) => string);
  /** Rewrite the raw string into prose. Default: strip a leading "TAG:" prefix. */
  body?: (raw: string, m: RegExpMatchArray) => string;
}

const stripPrefix = (raw: string): string => {
  const i = raw.indexOf(":");
  if (i < 0) return raw;
  const body = raw.slice(i + 1).trim();
  return body.charAt(0).toUpperCase() + body.slice(1);
};

/** Ordered most-specific first; the first match wins. */
const RULES: Rule[] = [
  {
    // 11-09: the price is comma-grouped ("$1,234,567"); `\$(\d+)` read it as "$1".
    test: /^ACQUIRED:\s*(.+?)\s+buys distressed\s+(.+?)\s+for \$([\d,]+)/i,
    kind: "market", title: "Rival bought out",
    body: (_r, m) => `${m[1]} bought ${m[2]}, a brewery in financial trouble, for $${m[3]} and took on its debt.`,
  },
  {
    test: /^ACQUISITION:\s*(.+?)\s+buys\s+(.+?)\s*\(online in (\d+) rounds?\)/i,
    kind: "opportunity", title: "Supply chain purchase",
    body: (_r, m) => `${m[1]} bought a ${m[2]}. It takes effect in ${m[3]} round${m[3] === "1" ? "" : "s"}.`,
  },
  {
    test: /^EXPANSION:\s*(.+?)\s+enters\s+(.+)$/i,
    kind: "opportunity", title: "New market entered",
    body: (_r, m) => `${m[1]} expanded into ${marketName(m[2])}.`,
  },
  {
    test: /^HIRE:\s*(.+?)\s+brings on a\s+(.+)$/i,
    kind: "opportunity", title: "Key hire",
    body: (_r, m) => `${m[1]} hired a ${m[2]}.`,
  },
  // DW-071: the labor-market attrition line (was "POACHED … to a rival offer" — no rival gains anyone).
  // DW-075: may carry what the tenure bonus took with them.
  {
    test: /^DEPARTURE:\s*(.+?)'s\s+(.+?)\s+leaves for another job(?:\s+[—-]\s+took (\d+) quarters? of built-up tenure \(\+(\d+)% bonus\))?/i,
    kind: "shock", title: "Key hire leaves",
    body: (_r, m) => `${m[1]}'s ${m[2]} left for another job.${m[3] ? ` Over ${m[3]} quarter${m[3] === "1" ? "" : "s"}, their boost to the firm had grown by ${m[4]}%, and that is lost too.` : ""} Departures are less likely when Taproom community is high.`,
  },
  // DW-075: the named-employee departures (MOD-B12), with the loyalty they took along.
  {
    test: /^DEPARTURE:\s*(.+?)\s+quits\s+(.+?)\s+[—-]\s+morale ran out(?:;\s+took (\d+) quarters? of built-up loyalty \(\+(\d+)% contribution\))?$/i,
    kind: "shock", title: "Employee quits",
    body: (_r, m) => `${m[2]} lost ${m[1]}, whose morale ran out.${LOYALTY_LOST(m[3], m[4])}`,
  },
  {
    test: /^POACHED:\s*a rival hires\s+(.+?)\s+away from\s+(.+?)(?:\s+[—-]\s+took (\d+) quarters? of built-up loyalty \(\+(\d+)% contribution\))?$/i,
    kind: "shock", title: "Talent poached",
    body: (_r, m) => `${m[2]} lost ${m[1]} to a rival's job offer.${LOYALTY_LOST(m[3], m[4])} Unhappy staff are easier to hire away, and loyal staff are harder.`,
  },
  {
    test: /^POACHED:\s*(.+?)\s+lures\s+(.+?)\s+away from\s+(.+?)(?:\s+[—-]\s+took (\d+) quarters? of built-up loyalty \(\+(\d+)% contribution\))?$/i,
    kind: "market", title: "Talent raid",
    body: (_r, m) => `${m[1]} hired ${m[2]} away from ${m[3]}.${LOYALTY_LOST(m[4], m[5])} ${m[2]} starts at ${m[1]} as a new hire.`,
  },
  // 11-09: the four kinds that still printed raw engine text. A build that couldn't go ahead and a turned-down
  // offer are the firms' own news (engine visibility.ts); a won parcel and an exit to investing are public.
  {
    test: /^BUILD BLOCKED:\s*(.+?)\s+can't fund a\s+(.+?)\s+\(needs\s+(\$[\d,]+)\)/i,
    kind: "shock", title: "Build blocked",
    body: (_r, m) => `${m[1]} couldn't pay for the ${m[2]} (it needs ${m[3]}), so it wasn't built.`,
  },
  {
    test: /^BUILD BLOCKED:\s*(.+?)\s+is at its facility cap\s+\((\d+)\)\s+—\s+(.+?)\s+not built/i,
    kind: "shock", title: "Build blocked",
    body: (_r, m) => `The ${m[3]} wasn't built: ${m[1]}'s ${m[2]} facilities are the most allowed.`,
  },
  {
    test: /^BUILD BLOCKED:\s*(.+?)\s+—\s+(?:parcel .+? not found in .+|that parcel isn't available yet|that parcel is already taken)/i,
    kind: "shock", title: "Build blocked",
    body: (raw) => `The build didn't go ahead: ${/already taken/i.test(raw) ? "another brewery took that parcel first" : "that parcel isn't available"}.`,
  },
  {
    test: /^POACH REBUFFED:\s*(.+?)\s+spurns\s+(.+?)\s+and stays with\s+(.+)$/i,
    kind: "info", title: "Job offer turned down",
    body: (_r, m) => `${m[1]} turned down ${m[2]}'s offer and stayed with ${m[3]}.`,
  },
  {
    test: /^PARCEL WON:\s*(.+?)\s+wins a contested parcel in\s+(.+?)\s+\((\$[\d,]+) premium\)/i,
    kind: "opportunity", title: "Contested parcel won",
    body: (_r, m) => `${m[1]} won a parcel another brewery also wanted in ${marketName(m[2])}, with a bid premium of ${m[3]}.`,
  },
  {
    test: /^EXIT→INVEST:\s*(.+?)\s+buys\s+([\d.]+)% of\s+(.+?)\s+at V=/i,
    kind: "market", title: "A brewery exits to invest",
    body: (_r, m) => `${m[1]} left the market and used its cash to buy ${m[2]}% of ${m[3]}.`,
  },
  {
    test: /^EXIT→INVEST failed \(no valid target\);\s*(.+?)\s+banked\s+(\$[\d,]+)/i,
    kind: "market", title: "A brewery exits",
    body: (_r, m) => `${m[1]} left the market. With no brewery to invest in, it kept ${m[2]} in cash.`,
  },
  {
    test: /^HIRE FAILED:\s*(.+?)\s+cannot cover a\s+(.+?)'s\s+(\$[\d,]+)/i,
    kind: "shock", title: "Hire fell through",
    body: (_r, m) => `${m[1]} couldn't pay a ${m[2]}'s ${m[3]} signing bonus and first salary, so the hire didn't happen.`,
  },
  // DW-083: the bank's answer, the affordability guard, a held-back repayment, the overdraft and a
  // purchase that couldn't be funded — all private to the firm they name (server/src/names.ts).
  // toSecondPerson rewrites these for the reader: the firm's name → "you", and every "its" → "your".
  {
    test: /^CREDIT REFUSED:\s*the bank lends\s+(.+?)\s+nothing of the\s+(\$[\d,]+)\s+it asked\s+—\s+(.+)$/i,
    kind: "shock", title: "Loan refused",
    body: (_r, m) => `The bank lent ${m[1]} nothing of the ${m[2]} asked for. The bank's reason: ${m[3]}.`,
  },
  {
    test: /^CREDIT:\s*the bank lends\s+(.+?)\s+only\s+(\$[\d,]+)\s+of the\s+(\$[\d,]+)\s+it asked\s+—\s+(.+)$/i,
    kind: "info", title: "Loan cut",
    body: (_r, m) => `The bank lent ${m[1]} only ${m[2]} of the ${m[3]} asked for. The bank's reason: ${m[4]}.`,
  },
  {
    test: /^REPAYMENT CUT:\s*(.+?)\s+repays\s+(nothing|\$[\d,]+)\s+of the\s+(\$[\d,]+)\s+it planned.*?(\$[\d,]+)\s+covenant floor/i,
    kind: "info", title: "Repayment held back",
    body: (_r, m) => m[2].toLowerCase() === "nothing"
      ? `${m[1]} repaid none of the ${m[3]} planned. A repayment can't take cash below ${m[4]}, the bank's minimum. The debt is still owed.`
      : `${m[1]} repaid ${m[2]} of the ${m[3]} planned. A repayment can't take cash below ${m[4]}, the bank's minimum, so the rest is still owed.`,
  },
  {
    test: /^BLOCKED:\s*(.+?)\s+cannot pay for its whole plan\s+—\s+(\$[\d,]+)\s+of spending against\s+(\$[\d,]+)\s+of cash and financing((?:\s+after\s+\$[\d,]+\s+set aside for running costs)?)(?:;\s*([^.]+))?\.\s*Cut:\s*(.+)$/i,
    kind: "shock", title: "Orders cut",
    body: (_r, m) => `${m[1]} couldn't pay for the whole plan. It called for ${m[2]} of spending, but cash and financing came to ${m[3]}${m[4] ?? ""}${m[5] ? ` (${m[5]})` : ""}. Cut to fit: ${m[6]}.`,
  },
  {
    test: /^OVERDRAFT EXHAUSTED:\s*(.+?)\s+is\s+(\$[\d,]+)\s+short and the bank's emergency line stops at\s+(\$[\d,]+)/i,
    kind: "shock", title: "Overdraft ran out",
    body: (_r, m) => `${m[1]} was ${m[2]} short of cash. The bank's emergency overdraft stops at ${m[3]}, so cash stayed below zero.`,
  },
  {
    test: /^OVERDRAFT:\s*the bank covers\s+(.+?)'s\s+(\$[\d,]+)\s+shortfall/i,
    kind: "shock", title: "Emergency overdraft",
    body: (_r, m) => `The bank covered ${m[1]}'s ${m[2]} shortfall with an emergency overdraft. That money is now debt, charged at the bank's penalty interest rate.`,
  },
  {
    test: /^PURCHASE FAILED:\s*(.+?)\s+cannot fund the\s+(.+?)\s+\((\$[\d,]+)/i,
    kind: "shock", title: "Purchase fell through",
    body: (_r, m) => `${m[1]} couldn't fund the ${m[2]} (${m[3]}), so it wasn't bought.`,
  },
  {
    test: /^EQUITY MARKET CLOSED:\s*no investor will fund\s+(.+?)'s\s+(\$[\d,]+) raise/i,
    kind: "shock", title: "Equity raise refused",
    body: (_r, m) => `No investor would fund ${m[1]}'s ${m[2]} raise. Losses have pushed its valuation (what investors think the firm is worth) to zero or below, so nothing was raised.`,
  },
  {
    test: /^EQUITY:\s*investors fund only\s+(\$[\d,]+)\s+of the\s+(\$[\d,]+)\s+(.+?)\s+sought/i,
    kind: "info", title: "Equity raise trimmed",
    body: (raw, m) => {
      const cap = raw.match(/(\d+)% of its valuation/)?.[1];
      return `Investors funded only ${m[1]} of the ${m[2]} ${m[3]} asked for. In one round, investors buy ${cap ? `at most ${cap}%` : "only part"} of what a firm is worth.`;
    },
  },
  {
    test: /^POACHED:\s*(.+?)\s+loses its\s+(.+?)\s+to a rival offer/i,
    kind: "shock", title: "Talent poached",
    body: (_r, m) => `${m[1]}'s ${m[2]} left for a rival's job offer.`,
  },
  {
    test: /^DILUTION:\s*(.+?)'s convertible note converts to equity/i,
    kind: "regulatory", title: "Convertible note became shares",
    body: (_r, m) => `${m[1]} couldn't repay the convertible note when it came due, so it turned into shares. The firm's existing owners now own a smaller slice.`,
  },
  {
    test: /^FINANCING:\s*(.+?)\s+pays off its revenue-based financing/i,
    kind: "info", title: "Financing paid off",
    body: (_r, m) => `${m[1]} finished paying off the revenue-based financing (a loan repaid from a share of sales).`,
  },
  {
    test: /^FINANCING:\s*(.+?)\s+repays its convertible note/i,
    kind: "info", title: "Convertible note repaid",
    body: (_r, m) => `${m[1]} repaid the convertible note when it came due, so no shares were given up.`,
  },
  {
    test: /^GUILD:\s*the industry "(.+?)" fund reaches its threshold/i,
    kind: "opportunity", title: "Industry fund reaches its goal",
    body: (_r, m) => {
      const fund = m[1].replace(/_/g, " ").toLowerCase();
      return `The industry's shared ${titleCase(fund)} fund reached its goal.${FUND_EFFECT[fund] ? ` ${FUND_EFFECT[fund]}` : ""} The benefit applies to every brewery, whether it paid in or not.`;
    },
  },
  {
    test: /^PR PLAY:\s*(.+?)\s+ran\s+(.+?)\s*—/i,
    kind: "opportunity", title: "PR play",
    body: (_r, m) => `${m[1]} ran ${m[2]}, a quick boost to brand that fades within a round or two.`,
  },
  {
    test: /^NEGATIVE PR:\s*(.+?)\s+caught in a controversy\s*\(brand\s*(−?-?[\d.]+)(.*?)\)/i,
    kind: "shock", title: "Brand controversy",
    body: (_r, m) => `${m[1]} got caught in a controversy. Brand fell by ${m[2].replace(/^[−-]/, "")}.${/soften/i.test(m[3]) ? " Loyal taproom regulars (Taproom community) softened the hit." : ""}`,
  },
  {
    test: /^MARKET SHIFT:/i,
    kind: "market", title: "Tastes are shifting",
    body: () => `Shoppers' tastes are changing. Quality is starting to matter more to ${SEG_LABEL.mass} shoppers.`,
  },
  {
    test: /^NEW CATEGORY:\s*(.+?)\s+opens\s+"(.+?)"\s+early through R&D/i,
    kind: "market", title: "New category opens",
    body: (_r, m) => `${m[1]} opened the ${seg(m[2])} category early through R&D. Any brewery can sell there now. The R&D leader gets a brand boost there for a few rounds.`,
  },
  {
    test: /^NEW CATEGORY:\s*segment\s*"(.+?)"\s+emerges/i,
    kind: "market", title: "New category opens",
    body: (_r, m) => `A new category, ${seg(m[1])}, is now open. Any brewery can sell there.`,
  },
  {
    test: /ANTITRUST investigation triggered.*?;\s*(\d+) firms? fined,\s*(\d+) pacts?\s+constrained/i,
    kind: "regulatory", title: "Antitrust action",
    body: (_r, m) => {
      const fined = +m[1], pacts = +m[2];
      if (fined === 0 && pacts === 0) return "Regulators opened an antitrust investigation, a check on deals that limit competition. No brewery was fined this round.";
      const did = [fined ? `fined ${fined} ${fined === 1 ? "brewery" : "breweries"}` : "", pacts ? `suspended ${pacts} ${pacts === 1 ? "pact" : "pacts"}` : ""].filter(Boolean).join(" and ");
      return `Antitrust regulators, who police deals that limit competition, ${did}.`;
    },
  },
  {
    test: /^MARKET CONDUCT:\s*(.+?)\s+drew a consumer-protection penalty\s*—\s*(.+)$/i,
    kind: "regulatory", title: "Fined for price gouging",
    body: (_r, m) => `Regulators fined ${m[1]} for price gouging. It held a large share of the market and priced far above its costs${/thin quality/i.test(m[2]) ? ", with below-average quality" : ""}. Its brand took a public hit too. Good standing with distributors and regulators, plus a strong reputation, shrinks this penalty.`,
  },
  {
    test: /^DISTRESS DUMPING:\s*(.+?)'s collapse depresses\s+(\w+)/i,
    kind: "shock", title: "Leftover stock dumped",
    body: (raw, m) => {
      const n = raw.match(/for (\d+) round/)?.[1];
      return `${m[1]} went under, and its leftover stock is being sold off cheap. That weakens ${seg(m[2])} sales for every other brewery ${n ? `for ${n} round${n === "1" ? "" : "s"}` : "for a while"}.`;
    },
  },
  {
    test: /^FORCED EXIT \(bankruptcy\):\s*(.+?)\s*\(/i,
    kind: "shock", title: "Brewery goes bankrupt",
    body: (_r, m) => `${m[1]} went bankrupt and left the market.`,
  },
  {
    // 11-09: the engine writes "recovers $1,234"; `recovers\s+([\d.]+)` never matched it.
    test: /^CLEAN EXIT \(bank\):\s*(.+?)\s+recovers\s+\$?([\d,.]+)/i,
    kind: "info", title: "Brewery cashes out",
    body: (_r, m) => `${m[1]} chose to leave the market and kept $${Math.round(dollars(m[2])).toLocaleString("en-US")} after paying off debt.`,
  },
  {
    test: /^RE-ENTRY:\s*(.+?)\s+re-activates\s*\(repositioned to\s+(.+?)\)/i,
    kind: "opportunity", title: "Brewery returns",
    body: (_r, m) => `${m[1]} is back in the market${focusOn(m[2])}.`,
  },
  {
    // 11-09: the engine writes "pays $1,234"; `pays\s*([\d.]+)` never matched it. Its round is 0-based (+1 for the UI).
    test: /^EXIT→REBUILD:\s*(.+?)\s+repositions to\s+(.+?),\s*pays\s*\$?([\d,.]+)\s*\(cooldown to r(\d+)\)/i,
    kind: "opportunity", title: "Brewery starts over",
    body: (_r, m) => `${m[1]} is starting over as a new brewery${focusOn(m[2])}. The restart cost $${Math.round(dollars(m[3])).toLocaleString("en-US")}. The new brewery opens in round ${+m[4] + 1}.`,
  },
  // Lobbying (MOD-A09)
  {
    test: /^LOBBYING SCRUTINY:\s*(.+?)\s+is fined/i,
    kind: "regulatory", title: "Fined for lobbying",
    body: (raw, m) => {
      const fine = raw.match(/\(\s*[−-]?\$([\d,]+)\)/)?.[1];
      return `${m[1]} was fined${fine ? ` $${fine}` : ""} for heavy lobbying. The more a brewery spends pushing a regulation, the likelier a fine. Good standing with distributors and regulators lowers the odds.`;
    },
  },
  {
    test: /^LOBBYING:\s*a\s*"(.+?)"\s*regulation passes/i,
    kind: "regulatory", title: "New regulation passes",
    body: (raw, m) => {
      const x = raw.match(/reshapes the (.+?) market for (\d+) rounds?/);
      if (!x) return `A new "${m[1]}" regulation passed. It changes how shoppers choose for a few rounds.`;
      const segs = listOf(x[1].split(/\s*&\s*/).map(seg));
      const effect = REG_EFFECT[m[1].toLowerCase()]?.(segs) ?? `it changes how shoppers in ${segs} choose`;
      return `A new "${m[1]}" regulation passed. For ${x[2]} round${x[2] === "1" ? "" : "s"}, ${effect}.`;
    },
  },
  // Contingent clauses (MOD-A05)
  {
    test: /^CLAUSE:.*?\b(auto-suspends|auto-terminates|opens for renegotiation)\b.*?\(([a-z_]+)\)\s*$/i,
    kind: "regulatory", title: "Pact clause triggered",
    body: (raw, m) => {
      const verb = m[1].toLowerCase();
      const cond = CLAUSE_COND[m[2].toLowerCase()] ?? m[2].replace(/_/g, " ");
      const what = verb.includes("suspend") ? "is paused" : verb.includes("terminate") ? "has ended" : "is open for renegotiation";
      return `${capFirst(cond)}. That triggered a clause in ${pactIn(raw)}, so the pact ${what}.`;
    },
  },
  // Renegotiation (MOD-A06)
  {
    test: /^(.+?)\s+calls to renegotiate\s+/i,
    kind: "opportunity", title: "Renegotiation requested",
    body: (raw, m) => `${m[1]} asked to renegotiate ${pactIn(raw)}.`,
  },
  {
    test: /^(.+?)\s+accepts new terms on\s+/i,
    kind: "info", title: "Pact terms updated",
    body: (raw, m) => `${m[1]} accepted new terms for ${pactIn(raw)}.`,
  },
  {
    test: /^(.+?)\s+exits\s+.+?\s+via renegotiation/i,
    kind: "shock", title: "Pact ended",
    body: (raw, m) => `${m[1]} left ${pactIn(raw)} during a renegotiation.${/\bformal\b/.test(raw) ? " Leaving a contract this way costs part of its breach penalty." : ""}`,
  },
  {
    test: /^(.+?)\s+rejects renegotiation of\s+/i,
    kind: "info", title: "Renegotiation rejected",
    body: (raw, m) => `${m[1]} turned down the new terms, so ${pactIn(raw)} continues unchanged.`,
  },
  {
    test: /^(.+?)\s+formed\s+(.+)$/i,
    kind: "opportunity", title: "Pact formed",
    body: (_r, m) => {
      // "formal supply_share with 2 contingent clause(s) (4-round term)"
      const [form = "", template = ""] = m[2].split(/\s+/);
      const pact = PACT_FORM[form] && template ? `a ${pactName(form, template)}` : `a ${m[2]}`;
      const clauses = m[2].match(/with (\d+) contingent clause/)?.[1];
      const term = m[2].match(/\((\d+)-round term\)/)?.[1];
      return `${listOf(m[1].split("+"))} formed ${pact}${term ? ` for ${term} rounds` : ""}.${clauses ? ` It has ${clauses} clause${clauses === "1" ? "" : "s"} that can pause, end or reopen it if a set event happens.` : ""}`;
    },
  },
  {
    test: /^(.+?)\s+defected from\s+(.+?)\s*\(/i,
    kind: "shock", title: "Pact broken",
    body: (raw, m) => `${m[1]} walked away from ${pactIn(raw)}. ${/^formal\b/i.test(m[2]) ? "Breaking a contract costs a cash penalty." : "Walking away costs trust with the crew (Taproom community) and with investors."}`,
  },
  // Lost bids — one firm's own news (visibility.ts). Since 11-09 the engine names the losing firm;
  // older stored lines named none (and reached every firm, so parseEvents collapsed the repeats).
  {
    test: /^OUTBID:\s*(?:(.+?)\s+lost\s+(.+?)\s+to a rival|(.+?)\s+signed with a rival)\s+—\s+their signing bonus\s+(\$[\d,]+)\s+beat yours\s+\((\$[\d,]+)\)/i,
    kind: "info", title: "Outbid for a hire",
    body: (_r, m) => `${m[2] ?? m[3]} signed with a rival. Their signing bonus of ${m[4]} beat yours of ${m[5]}.`,
  },
  {
    test: /^OUTBID:\s*(.+?)\s+lost a contested parcel in\s+(.+?)\s+to a higher bid premium\s+\(theirs\s+(\$[\d,]+)\s+vs yours\s+(\$[\d,]+)\)/i,
    kind: "info", title: "Outbid for a parcel",
    body: (_r, m) => `A rival's bid premium of ${m[3]} beat yours of ${m[4]} for a parcel in ${marketName(m[2])}.`,
  },
  {
    test: /^CANDIDATE LOST:\s*(.+?)\s+took a rival's otherwise-equal offer(?:\s+over\s+.+?)?\s+on a tie-break/i,
    kind: "info", title: "Hire lost on a tie-break",
    body: (_r, m) => `${m[1]} took a rival's equal offer, decided by a tie-break. The higher signing bonus always wins a contested hire.`,
  },
  {
    test: /^CANDIDATE LOST:\s*(.+)$/i,
    kind: "info", title: "Hire lost to a rival",
    body: (_r, m) => m[1].charAt(0).toUpperCase() + m[1].slice(1) + (/[.!?]$/.test(m[1]) ? "" : "."),
  },
  {
    test: /^PARCEL LOST:\s*(.+?)\s+lost a contested parcel in\s+(.+?)\s+on a tie-break/i,
    kind: "info", title: "Parcel lost on a tie-break",
    body: (_r, m) => `${m[1]} lost a parcel in ${marketName(m[2])} that a rival also wanted. The bids were equal, so a tie-break decided it. The higher bid premium always wins a contested parcel.`,
  },
  // Shocks (no firm named). Parse the structured "SHOCK fired: <type> (<kind>, mag
  // <m>, <signaling>)" / "SHOCK live-triggered: <type>" forms into prose; the raw
  // type/kind/magnitude ids must never reach the player.
  {
    test: /^SHOCK (?:fired|live-triggered):\s*([a-z0-9_]+)(?:\(live\))?\s*(?:\(([a-z_]+),\s*mag\s*([\d.]+)[^)]*\))?(?:\s+in\s+(.+?))?\s*$/i,
    kind: "shock",
    title: (m) => SHOCK_LABEL[m[1].toLowerCase()] ?? "Market disruption",
    body: (_r, m) => {
      const id = m[1].toLowerCase();
      const label = SHOCK_LABEL[id] ?? "A shock";
      const where = m[4] ? ` in ${marketName(m[4])}` : "";
      if (!m[2]) return `${label} hit${where || " the market"} this round.`;
      return `${label}${where}: ${SHOCK_WHAT[id] ?? SHOCK_KIND[m[2]] ?? "the market was disrupted"} ${severity(+m[3])} this round${where ? " for producers there" : ""}.`;
    },
  },
  { test: /SHOCK/i, kind: "shock", title: "Market disruption", body: (r) => stripPrefix(r) },
];

function classify(raw: string): { kind: EventKind; title: string; body: string } {
  for (const r of RULES) {
    const m = raw.match(r.test);
    if (m) {
      const title = typeof r.title === "function" ? r.title(m) : r.title;
      return { kind: r.kind, title, body: r.body ? r.body(raw, m) : stripPrefix(raw) };
    }
  }
  return { kind: "info", title: "", body: stripPrefix(raw) };
}

/** Whole-word/phrase match so a short brewery name ("ya") doesn't false-match
 *  inside another word ("loYAl"). Bounded by non-letter chars or string ends. */
function mentionsName(text: string, name: string): boolean {
  if (!name) return false;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}])${esc}([^\\p{L}]|$)`, "u").test(text);
}

/** "Copper & Cask breaks ground" → "You break ground". The engine writes a firm's own moves
 *  in the third-person singular; swapping the name for "You" leaves the verb conjugated for
 *  "it" ("You breaks ground", "You brings on Hana B."). Re-conjugate the first word. */
const IRREGULAR_2P: Record<string, string> = { is: "are", was: "were", has: "have", does: "do", goes: "go", focuses: "focus" };
function secondPerson(rest: string): string {
  return rest.replace(/^(\s+)([A-Za-z]+)/, (_all, sp: string, w: string) => {
    const lw = w.toLowerCase();
    if (IRREGULAR_2P[lw]) return sp + IRREGULAR_2P[lw];
    if (!lw.endsWith("s") || /(ss|us|is)$/.test(lw)) return sp + w; // past tense, "was" handled above, nouns like "bonus"
    if (lw.endsWith("ies")) return sp + w.slice(0, -3) + "y";
    if (/(sses|shes|ches|xes|zes)$/.test(lw)) return sp + w.slice(0, -2);
    return sp + w.slice(0, -1);
  });
}

/** Routine operating moves every house makes most rounds. One line per event made round 1 a
 *  wall of near-identical notices; these roll up into ONE line per house so the column reads
 *  at a glance ("who staffed up, who built"). Written in the past tense, which also reads
 *  correctly for "You". */
const ROLLUPS: { test: RegExp; verb: "hired" | "built"; what: (m: RegExpMatchArray) => string }[] = [
  // "HIRE: <house> brings on Hana B., a head brewer" → "Hana B. (head brewer)"; the labor-market
  // form "brings on a head brewer" stays as written.
  { test: /^HIRE:\s*(.+?)\s+brings on\s+(.+)$/i, verb: "hired", what: (m) => m[2].replace(/^(.+?),\s+an?\s+(.+)$/i, "$1 ($2)") },
  // "a taproom in Heartland (online in 1 round)" → the map's city name (DW-082d); older lines carry no market.
  { test: /^FACILITY BUILT:\s*(.+?)\s+breaks ground on\s+(.+)$/i, verb: "built", what: (m) => m[2].replace(/\bin (.+?) \(online/, (_s, l: string) => `in ${marketName(l)} (online`).replace("(online in ", "(ready in ") },
];
const listOf = (xs: string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * Parse engine event strings into framed dispatches. `youName` (the player's
 * brewery name, already substituted into the strings upstream) flags which
 * dispatches actually involve the player and rewrites a leading self-reference
 * to "You" so the player's own moves read in first person.
 *
 * Two passes keep the page glanceable: routine hires and builds roll up into one line per
 * house, and any dispatches that still read identically collapse into one with a `count`.
 */
/** The notices server/src/names.ts sends only to the firm they name (DW-083). Not POACHED: its long form names
 *  the rival too ("Bitter Root lured Lena R. away from …"), so an "its" there need not be the reader's. */
const PRIVATE_NOTICE = /^(CREDIT REFUSED|CREDIT|REPAYMENT CUT|BLOCKED|BUILD BLOCKED|HIRE FAILED|OVERDRAFT EXHAUSTED|OVERDRAFT|PURCHASE FAILED|EQUITY MARKET CLOSED|EQUITY):/i;
const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The firm's name → "you"/"your", and the firm's own "its" → "your". Safe only on a private notice, where the
 *  one firm named is the reader's and every "its" is the firm's ("losses have used up its equity"). */
function toSecondPerson(body: string, youName: string): string {
  const name = escapeRe(youName);
  return body.replace(new RegExp(`${name}'s\\b`, "g"), "your").replace(new RegExp(name, "g"), "you").replace(/\bits\b/g, "your");
}

/** 11-06 playtest · the results page's news, split by whom it hit. The private notices (the guard's cuts, the
 *  bank's answer, the overdraft, a failed purchase, a poached hire) are about this firm, not the market:
 *  eventFeed types the bad ones "shock", and the market card printed its generic "A market disruption this
 *  round" over them; "Loan cut" (info) never showed at all. */
export const FIRM_NEWS = new Set(["Loan refused", "Loan cut", "Repayment held back", "Orders cut", "Build blocked", "Hire fell through", "Overdraft ran out", "Emergency overdraft", "Purchase fell through", "Equity raise refused", "Equity raise trimmed", "Talent poached"]);
export function roundNews(events: string[], youName = "", opts: FeedOpts = {}): { market: GameEvent[]; firm: GameEvent[] } {
  const all = parseEvents(events, youName, opts);
  return {
    market: all.filter((e) => (e.kind === "shock" || e.kind === "market") && !FIRM_NEWS.has(e.title)),
    firm: all.filter((e) => e.mine && FIRM_NEWS.has(e.title)),
  };
}

/** `tankUnits`: dollars → units of tank capacity (the game's conversion), so a cut tank order says what it bought. */
export interface FeedOpts { tankUnits?: (dollars: number) => number }
const dollars = (x: string) => Number(x.replace(/[$,]/g, ""));

export function parseEvents(events: string[], youName = "", opts: FeedOpts = {}): GameEvent[] {
  const out: GameEvent[] = [];
  const houses = new Map<string, { hired: string[]; built: string[]; at: number }>();

  events.forEach((raw, i) => {
    for (const r of ROLLUPS) {
      const m = raw.match(r.test);
      if (!m) continue;
      const h = houses.get(m[1]) ?? { hired: [], built: [], at: out.length };
      if (!houses.has(m[1])) { houses.set(m[1], h); out.push({ id: `house:${m[1]}`, kind: "info", title: m[1], body: "" }); }
      h[r.verb].push(r.what(m));
      return;
    }
    const { kind, title, body } = classify(raw);
    const mine = mentionsName(raw, youName);
    // "Copper & Cask ran …" → "You ran …" when it's the player's own dispatch.
    const lead = mine && youName && body.startsWith(youName + " ")
      ? "You" + secondPerson(body.slice(youName.length))
      : body;
    // 11-06 playtest: a private notice names only its own firm, so it can read wholly in the second person —
    // "The bank lent you only $427,493", not "lent Alder Ale Works only" under a "you" chip.
    const second = mine && youName && PRIVATE_NOTICE.test(raw) ? toSecondPerson(lead, youName) : lead;
    // 11-06 (Devin): "only got x amount of additional capacity" — the cut order in units, not just dollars.
    const text = title === "Orders cut" && opts.tankUnits
      ? second.replace(/tank order (\$[\d,]+) → (\$[\d,]+)/, (all, a: string, b: string) => `${all} (${Math.round(opts.tankUnits!(dollars(b))).toLocaleString("en-US")} units of new capacity instead of ${Math.round(opts.tankUnits!(dollars(a))).toLocaleString("en-US")})`)
      : second;
    const struck = kind === "shock" ? raw.match(/^SHOCK fired:.*\)\s+in\s+(.+?)\s*$/i)?.[1] : undefined;
    const region = struck ? marketName(struck) : undefined; // the map's city name
    out.push({ id: `${i}:${raw}`, kind, title, body: text, mine, ...(region ? { region } : {}) });
  });

  for (const [name, h] of houses) {
    const mine = !!youName && name === youName;
    const parts = [h.hired.length ? `hired ${listOf(h.hired)}` : "", h.built.length ? `started building ${listOf(h.built)}` : ""].filter(Boolean);
    const sentence = parts.join("; ") + ".";
    out[h.at] = { ...out[h.at], title: mine ? "Your house" : name, body: mine ? `You ${sentence}` : sentence.charAt(0).toUpperCase() + sentence.slice(1), mine };
  }

  // Collapse dispatches that read identically (a lost tie-break prints once per losing house).
  const seen = new Map<string, GameEvent>();
  for (const e of out) {
    const key = `${e.kind}|${e.title}|${String(e.body)}`;
    const first = seen.get(key);
    if (first) {
      first.count = (first.count ?? 1) + 1;
      // Keep the "you" flag if ANY copy was the player's. It used to be inherited from
      // whichever copy happened to come first, so a rival's identically-worded dispatch
      // arriving earlier stripped the copper rail off the player's own line and dropped it
      // from the Dispatch count badge.
      first.mine = first.mine || e.mine;
    } else seen.set(key, e);
  }
  return [...seen.values()];
}

// ───────────────────────── the Dispatch as a hierarchy (11-09) ─────────────────────────
/** 11-09 (Devin's review): section → group → one compact line per destination or house, with team chips.
 *  Same-kind moves fold together — "New markets entered: Switchback + Iron Kettle → Harbor City ·
 *  Cobblestone → Cedar Falls". Anything without a group keeps its own headline and prose (parseEvents). */
export interface DispatchLine { firms: string[]; text: string; mine: boolean }
export interface DispatchGroup { id: string; kind: EventKind; title: string; lines: DispatchLine[]; mine: boolean; count: number }
interface GroupRule {
  id: string; title: string; test: RegExp;
  firm: (m: RegExpMatchArray) => string;
  /** "target": firms sharing a target fold into one line ("A + B → Harbor City"); "firm": one line per house. */
  by: "target" | "firm";
  item: (m: RegExpMatchArray) => string;
}
const GROUPS: GroupRule[] = [
  { id: "entry", title: "New markets entered", test: /^EXPANSION:\s*(.+?)\s+enters\s+(.+)$/i, by: "target", firm: (m) => m[1], item: (m) => marketName(m[2]) },
  { id: "built", title: "Construction started", test: /^FACILITY BUILT:\s*(.+?)\s+breaks ground on\s+an?\s+(.+?)(?:\s+in\s+(.+?))?\s+\(online in \d+ rounds?\)$/i, by: "firm", firm: (m) => m[1], item: (m) => `${m[2]}${m[3] ? ` in ${marketName(m[3])}` : ""}` },
  { id: "sold", title: "Sites sold", test: /^FACILITY DIVESTED:\s*(.+?)\s+sells off\s+(.+?)(?:\s+\(recovers [^)]*\))?$/i, by: "firm", firm: (m) => m[1], item: (m) => m[2] },
  { id: "hire", title: "Hires", test: /^HIRE:\s*(.+?)\s+brings on\s+(.+)$/i, by: "firm", firm: (m) => m[1], item: (m) => m[2].replace(/^(.+?),\s+an?\s+(.+)$/i, "$1 ($2)").replace(/^an?\s+/i, "a ") },
  { id: "hire", title: "Hires", test: /^SIGNED:\s*(.+?)\s+wins\s+(.+?)\s+in a contested hire/i, by: "firm", firm: (m) => m[1], item: (m) => `${m[2]} (won a bidding war)` },
  { id: "layoff", title: "Layoffs", test: /^LAYOFF:\s*(.+?)\s+lets go\s+(.+)$/i, by: "firm", firm: (m) => m[1], item: (m) => m[2] },
  { id: "pr", title: "PR plays", test: /^PR PLAY:\s*(.+?)\s+ran\s+(.+?)\s*—/i, by: "firm", firm: (m) => m[1], item: (m) => m[2] },
  { id: "vertical", title: "Supply chain purchases", test: /^ACQUISITION:\s*(.+?)\s+buys\s+(.+?)\s*\(online in \d+ rounds?\)/i, by: "firm", firm: (m) => m[1], item: (m) => m[2] },
  { id: "fine", title: "Fines", test: /^MARKET CONDUCT:\s*(.+?)\s+drew a consumer-protection penalty/i, by: "firm", firm: (m) => m[1], item: () => "price-gouging fine" },
  { id: "fine", title: "Fines", test: /^LOBBYING SCRUTINY:\s*(.+?)\s+is fined for influence-peddling/i, by: "firm", firm: (m) => m[1], item: () => "lobbying fine" },
];

/** Group the round's raw events (names already substituted) for the Dispatch. Returns the groups and the
 *  events that keep their own dispatch (parsed as before), in event order. */
export function groupDispatch(events: string[], youName = "", opts: FeedOpts = {}): { groups: DispatchGroup[]; singles: GameEvent[] } {
  const byId = new Map<string, { g: DispatchGroup; keyed: Map<string, DispatchLine & { items: string[] }> }>();
  const rest: string[] = [];
  for (const raw of events) {
    const rule = GROUPS.find((r) => r.test.test(raw));
    const m = rule ? raw.match(rule.test) : null;
    if (!rule || !m) { rest.push(raw); continue; }
    const entry = byId.get(rule.id) ?? { g: { id: rule.id, kind: classify(raw).kind, title: rule.title, lines: [], mine: false, count: 0 }, keyed: new Map() };
    byId.set(rule.id, entry);
    const firm = rule.firm(m).trim(), item = rule.item(m).trim();
    const mine = !!youName && firm === youName;
    const key = rule.by === "target" ? item : firm;
    const line = entry.keyed.get(key) ?? { firms: [], text: "", mine: false, items: [] };
    entry.keyed.set(key, line);
    if (rule.by === "target") { if (!line.firms.includes(firm)) line.firms.push(firm); line.text = `→ ${item}`; }
    else { line.firms = [firm]; line.items.push(item); line.text = line.items.join(", "); }
    line.mine = line.mine || mine;
    entry.g.mine = entry.g.mine || mine;
    entry.g.count++;
  }
  const groups = [...byId.values()].map(({ g, keyed }) => ({ ...g, lines: [...keyed.values()].map(({ firms, text, mine }) => ({ firms, text, mine })).sort((a, b) => Number(b.mine) - Number(a.mine)) }));
  return { groups, singles: parseEvents(rest, youName, opts) };
}
