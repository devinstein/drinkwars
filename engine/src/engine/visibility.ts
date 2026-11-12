/**
 * Who may read each round event (11-09, Devin's review: the Tap Dispatch printed a rival's
 * "Orders cut — couldn't pay for its whole plan"). One rule for every surface: solo play, the
 * Node transport and the edge function all filter through `visibleEvents`, so a new event
 * can't be private on one and public on another. The instructor dashboard keeps the full list.
 *
 *   public  — news anyone in the market would hear: entries, sites, exits, hires and
 *             departures, deals, shocks, regulation, PR, fines, pacts formed or broken.
 *   named   — one firm's own business: the bank's answer, orders cut for cash, a failed
 *             purchase or hire, a lost bid, a financing instrument, a pact still being
 *             negotiated. Only the firms the event names see it.
 *   parties — a pact's internal step that names one side only (a renegotiation call or
 *             answer): its signatories see it as well as the firm named.
 *
 * Every event the engine can emit must match a rule; `engine/test/visibility.test.ts` scans
 * the source and fails on one that doesn't. An unmatched event falls back to `named`, so a
 * rule forgotten later fails private, not public.
 */
export type EventAudience = "public" | "named" | "parties";

const RULES: { test: RegExp; audience: EventAudience }[] = [
  // ── one firm's own money and plans (named) ──
  { test: /^BLOCKED:/, audience: "named" }, // the affordability guard cut orders
  { test: /^BUILD BLOCKED:/, audience: "named" }, // a build that couldn't go ahead (cash, cap, parcel)
  { test: /^CREDIT( REFUSED)?:/, audience: "named" },
  { test: /^REPAYMENT CUT:/, audience: "named" },
  { test: /^OVERDRAFT( EXHAUSTED)?:/, audience: "named" },
  { test: /^PURCHASE FAILED:/, audience: "named" },
  { test: /^EQUITY( MARKET CLOSED)?:/, audience: "named" },
  { test: /^HIRE FAILED:/, audience: "named" },
  { test: /^FINANCING:/, audience: "named" }, // revenue-based financing / convertible repaid
  { test: /^DILUTION:/, audience: "named" }, // a convertible note converted
  { test: /^OUTBID:/, audience: "named" }, // lost a contested parcel or hire on the bid
  { test: /^PARCEL LOST:/, audience: "named" },
  { test: /^CANDIDATE LOST:/, audience: "named" },
  { test: /^POACH REBUFFED:/, audience: "named" }, // the poacher and the employer it tried
  { test: /^REBUILD rejected:/, audience: "named" },
  // ── a pact still being negotiated (named: both sides appear in the text) ──
  { test: / proposes a .+ to .+ — awaiting/, audience: "named" },
  { test: / counters .+ proposal with revised terms/, audience: "named" },
  { test: / declines .+'s .+ proposal$/, audience: "named" },
  { test: / accepts .+'s .+ proposal — awaiting/, audience: "named" },
  { test: /'s .+ proposal to .+ lapsed unanswered$/, audience: "named" },
  { test: / collective pact rejected/, audience: "named" },
  // ── a pact's internal step that names one side (parties) ──
  { test: / calls to renegotiate /, audience: "parties" },
  { test: / accepts new terms on /, audience: "parties" },
  { test: / rejects renegotiation of /, audience: "parties" },
  // ── public news ──
  {
    test: /^(SHOCK|MARKET SHIFT|NEW CATEGORY|GUILD|LOBBYING|MARKET CONDUCT|ANTITRUST|PR PLAY|NEGATIVE PR|EXPANSION|FACILITY BUILT|FACILITY DIVESTED|PARCEL WON|HIRE|SIGNED|POACHED|DEPARTURE|LAYOFF|ACQUISITION|ACQUIRED|DISTRESS DUMPING|FORCED EXIT|CLEAN EXIT|EXIT→INVEST|EXIT→REBUILD|RE-ENTRY|CLAUSE)\b/,
    audience: "public",
  },
  { test: /^\S+ formed /, audience: "public" }, // "firm_1+firm_4 formed formal supply_share"
  { test: / defected from /, audience: "public" },
  { test: / exits .+ via renegotiation/, audience: "public" },
  { test: / reached its negotiated \S+ term and wound down$/, audience: "public" },
];

/** The rule an event falls under, or null when no rule matches (the test's tripwire). */
export function eventAudience(e: string): EventAudience | null {
  for (const r of RULES) if (r.test.test(e)) return r.audience;
  return null;
}

/** DW-080: what a firm LOST with a person — the loyalty / tenure tail on a POACHED or DEPARTURE line
 *  ("— took 4 quarters of built-up loyalty (+16% contribution)") — is that firm's private read on its
 *  own people (DW-075). Rivals, the poacher included, see the move; only the firm it left sees the cost. */
const PRIVATE_TAIL = /(?:\s+[—-]|;)\s+took \d+ quarters? of built-up (?:loyalty|tenure) \(\+\d+% (?:contribution|bonus)\)$/;
const victimOf = (e: string): string | null => (e.match(/away from (firm_\d+)/) ?? e.match(/quits (firm_\d+)/) ?? e.match(/^DEPARTURE: (firm_\d+)'s/))?.[1] ?? null;
const names = (e: string, id: string) => new RegExp(`\\b${id}\\b`).test(e);

/** The events `ownFirmId` may read, on raw engine text (firm ids, before names are substituted).
 *  `partiesOf` maps a pact id ("a_3_1") to its signatories, for the `parties` events; without it
 *  those read like `named`. No firm (an observer) sees only public news. */
export function visibleEvents(events: string[], ownFirmId: string | null | undefined, partiesOf?: (agreementId: string) => readonly string[] | undefined): string[] {
  return events
    .filter((e) => {
      const a = eventAudience(e) ?? "named";
      if (a === "public") return true;
      if (!ownFirmId) return false;
      if (names(e, ownFirmId)) return true;
      if (a !== "parties" || !partiesOf) return false;
      const ag = e.match(/\((a_\d+_\d+)\)/)?.[1];
      return !!ag && (partiesOf(ag) ?? []).includes(ownFirmId);
    })
    .map((e) => (/^(POACHED|DEPARTURE):/.test(e) && victimOf(e) !== ownFirmId ? e.replace(PRIVATE_TAIL, "") : e));
}

/** A `partiesOf` lookup over a world's pacts (dissolved ones included, so a renegotiation exit still routes). */
export function pactParties(agreements: readonly { id: string; signatories: readonly string[] }[] | undefined): (agreementId: string) => readonly string[] | undefined {
  const m = new Map((agreements ?? []).map((a) => [a.id, a.signatories] as const));
  return (id) => m.get(id);
}
