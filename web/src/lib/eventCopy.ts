/**
 * DW-077 event copy (design/round-ux-2026-10 §A) — what a market event means, in the voice of
 * the takeover card and the wire strip, for every shock the engine can fire × every seat ×
 * both phases (announced → hits). Pure: reads the GameView only for cheap live numbers (the
 * COO's unit cost, the firm's capacity).
 *
 * The `water` and `demand_slump` (Recession) seat lines began as the mockup's `FOR` object in
 * `Event Moment.dc.html` ("next round" became `{eta}` so the same line stays honest when the ETA is
 * "when this round closes" or "in about 2 rounds"). 11-09 plain-language pass: every line now states
 * what the event does to the seat's numbers and the game rules that touch it (what softens it, when
 * spending counts), with no advice on what to do. Students work that out. The instructor reviews the
 * copy before a class sees it.
 *
 * Rules the lines lean on (engine): Brewing operations and Taproom community soften the cost and
 * capacity shocks (water, harvest, CO₂), and spending on them counts one round later; water efficiency
 * softens a water shortage in the round it is funded; tank orders start brewing next round; the demand
 * shocks change how many shoppers buy, not how they weigh price, quality and brand.
 *
 * Phases: "announced" = a signaled shock the engine lists ahead of time (`active:false,
 * roundsAway ≥ 0`); "hits" = `active:true`. Unannounced shocks (water / harvest / co2) only ever
 * appear as hits, but every id carries both phases so a gamemaster-planted one reads correctly.
 */
import type { GameView, ShockSignal } from "../game/controller.js";
import { SEG_LABEL, fmt, marketName } from "../labels.js";
import type { SeatRole } from "./seatColors.js";

export type WirePhase = "announced" | "hits";
export type CopyRole = SeatRole | "member";
export interface SeatLine { short: string; long: string }
type Live = (view: GameView, eta: string, share: number, phase: WirePhase) => SeatLine;
type SeatCopy = Record<CopyRole, SeatLine | Live>;

export interface WireEvent {
  key: string; // stable across the announced → hits transition: `${typeId}:${round}:${target}`
  phase: WirePhase;
  tone: "red" | "amber";
  tag: string; // HITTING NOW · NEXT ROUND · THIS ROUND · IN n ROUNDS
  when: string; // ROUND n · ~ROUND n
  kicker: string; // ON THE WIRE · ROUND n · HITTING NOW
  scope: string; // INDUSTRY-WIDE · LAGERS & LIGHT …
  title: string; // Water shortage
  summary: string; // brewing costs jump sharply this round
  headline: string; // The water shortage is here
  subline: string; // It hits every brewery this round. Brewing costs jump sharply.
  short: string; // For your desk: … (strip)
  long: string; // What it means for your desk (takeover)
}

const L = (short: string, long: string): SeatLine => ({ short, long });
/** Mean magnitudes from engine/src/config/defaults.ts — for a "roughly" number, not a promise. */
const COST_MEAN: Record<string, number> = { water: 0.35, harvest: 0.55 };
const CO2_CAP_MEAN = 0.28;

interface ShockCopy {
  title: string;
  summary: Record<WirePhase, string>;
  headline: Record<WirePhase, string>;
  subline: Record<WirePhase, string>;
  seats: Record<WirePhase, SeatCopy>;
}

const costUp = (id: string): Live => (view, _eta, share, phase) => {
  const now = view.unitCostEst;
  // DW-080: a shock only shows as "hits" once it has fired, so last round's unit cost (the estimate's
  // basis) already carries the spike — multiplying again counted it twice.
  if (phase === "hits") return L(`Your unit cost holds near ${fmt.price(now)} while it lasts.`, `Last round's unit cost (${fmt.price(now)}) already includes the spike, so expect about the same while it lasts. Brewing operations and Taproom community soften cost shocks, one round after you fund them.`);
  const up = now * (1 + (COST_MEAN[id] ?? 0.35) * share);
  return L(`Unit cost could rise to about ${fmt.price(up)}.`, `Unit cost could rise from ${fmt.price(now)} to about ${fmt.price(up)} before anything softens it. Brewing operations and Taproom community soften cost shocks, one round after you fund them.`);
};

const COPY: Record<string, ShockCopy> = {
  water: {
    title: "Water shortage",
    summary: { announced: "a drought will push brewing costs up", hits: "brewing costs jump sharply this round" },
    headline: { announced: "A water shortage is coming", hits: "The water shortage is here" },
    subline: { announced: "Expected {eta}. Every brewery will pay more to brew each drink.", hits: "It hits every brewery this round. Brewing costs jump sharply." },
    seats: {
      hits: {
        ceo: L("Each drink costs more to brew this round.", "Each drink costs more to brew this round. Water efficiency softens a water shortage in the round you fund it. Brewing operations and Taproom community soften it too, one round after you fund them."),
        cfo: L("Each drink earns less this round.", "Higher brewing costs shrink the margin on every drink this round. Lower profit can also shrink what the bank will lend."),
        coo: costUp("water"),
        cmo: L("Rivals hit by the shortage pay more too.", "Rivals hit by the shortage pay more per drink too. Holding your price keeps more shoppers; raising it keeps more margin per drink. That choice is yours."),
        chro: L("No direct hit on your levers.", "No direct hit on your levers. Taproom community helps soften cost shocks like this one, one round after you fund it."),
        member: L("Every drink costs more to brew this round.", "Every drink costs more to brew this round. Water efficiency softens it in the round you fund it. Holding your price keeps more shoppers; raising it keeps more margin per drink."),
      },
      announced: {
        ceo: L("A cost spike hits {eta}.", "Brewing costs jump {eta}. Water efficiency softens a water shortage in the round you fund it. Brewing operations and Taproom community soften it one round after you fund them."),
        cfo: L("Brewing costs jump {eta}.", "Brewing costs jump {eta}, so each drink earns less while the shortage lasts. Lower profit can also shrink what the bank will lend."),
        coo: L("Unit cost jumps {eta}.", "Unit cost jumps {eta}. Brewing operations softens it one round after you fund it. Water efficiency softens it in the round you fund it. Tanks ordered now start brewing next round."),
        cmo: L("Rivals hit by it will pay more too.", "Rivals hit by the shortage will pay more per drink too {eta}. Holding your price keeps more shoppers; raising it keeps more margin per drink."),
        chro: L("Taproom community softens cost shocks.", "Taproom community helps soften cost shocks like this one. Spending on it counts one round after you make it."),
        member: L("Brewing costs jump {eta}.", "Brewing costs jump {eta}. Water efficiency counts in the round you fund it. Brewing operations and Taproom community count one round later."),
      },
    },
  },
  harvest: {
    title: "Harvest failure",
    summary: { announced: "a poor hop and barley harvest is expected", hits: "grain and hop costs jump sharply this round" },
    headline: { announced: "A bad harvest is coming", hits: "The harvest has failed" },
    subline: { announced: "Expected {eta}. Hop and barley prices will jump for every brewery.", hits: "Hop and barley prices jump for every brewery this round. It lasts one round, and the jump is steep." },
    seats: {
      hits: {
        ceo: L("The biggest cost jump in the game, for one round.", "Unit cost takes its biggest jump of the game this round. Brewing operations and Taproom community soften it, but spending on them now counts only from next round."),
        cfo: L("Margin may be thin or negative this round.", "Gross margin may be thin or negative this round. The cost jump lasts one round."),
        coo: costUp("harvest"),
        cmo: L("Every brewery's costs jump this round.", "Every brewery pays the same jump. A higher price keeps more margin per drink but loses some shoppers to anyone who holds theirs."),
        chro: L("No direct hit on your levers.", "No direct hit on your levers. Taproom community helps soften cost shocks, one round after you fund it."),
        member: L("Grain and hop costs jump this round.", "Every drink costs far more to brew this round. The jump lasts one round."),
      },
      announced: {
        ceo: L("A steep cost jump hits {eta}.", "A steep one-round cost jump hits {eta}. Brewing operations and Taproom community soften it, one round after you fund them. Tanks ordered now start brewing next round."),
        cfo: L("Margin drops for one round {eta}.", "Margin drops sharply for one round {eta}. Profit and cash flow fall that round."),
        coo: L("Unit cost jumps for one round {eta}.", "Unit cost jumps for one round {eta}. Brewing operations softens it, one round after you fund it. Tanks ordered now start brewing next round."),
        cmo: L("Every brewery's costs jump {eta}.", "Costs jump for every brewery {eta}, for one round. A higher price keeps more margin per drink; holding it keeps more shoppers."),
        chro: L("Taproom community softens cost shocks.", "Taproom community helps soften cost shocks like this one. Spending on it counts one round after you make it."),
        member: L("A steep one-round cost jump hits {eta}.", "Brewing costs jump sharply for one round {eta}. Brewing operations and Taproom community soften it, one round after you fund them."),
      },
    },
  },
  co2: {
    title: "CO₂ & packaging squeeze",
    summary: { announced: "a packaging and CO₂ shortage is coming", hits: "no brewery can run at full capacity this round" },
    headline: { announced: "A packaging squeeze is coming", hits: "The CO₂ squeeze is here" },
    subline: { announced: "Expected {eta}. Cans, CO₂ and kegs will run short, so tanks can't run full.", hits: "Cans, CO₂ and kegs ran short. Every brewery runs below capacity this round." },
    seats: {
      hits: {
        ceo: L("Your tanks run below capacity this round.", "Every brewery can brew less this round. Shoppers you can't serve may buy from a rival. Brewing operations and Taproom community soften the cut."),
        cfo: L("Fewer drinks to sell, same fixed costs.", "Revenue falls with volume this round, while upkeep and interest stay the same."),
        coo: (view) => L(`Capacity falls to about ${fmt.int(view.own.cap * (1 - CO2_CAP_MEAN))} drinks.`, `Capacity falls from ${fmt.int(view.own.cap)} to about ${fmt.int(view.own.cap * (1 - CO2_CAP_MEAN))} drinks before anything softens the cut. Brewing operations and Taproom community soften it, one round after you fund them.`),
        cmo: L("You have fewer drinks to sell this round.", "You may have fewer drinks than shoppers want this round. A higher price earns more per drink but turns some shoppers away."),
        chro: L("No direct hit on your levers.", "No direct hit on your levers. Taproom community helps soften a capacity cut like this one, one round after you fund it."),
        member: L("You can't brew at full capacity this round.", "Capacity is cut this round. You choose how the drinks you can brew are split across categories."),
      },
      announced: {
        ceo: L("Capacity is cut {eta}.", "Every brewery runs below capacity {eta}. New tanks are cut by the same share. Brewing operations and Taproom community soften the cut, one round after you fund them."),
        cfo: L("A low-volume round is coming.", "Volume drops {eta} while fixed costs stay the same. Tanks cost upkeep even when the squeeze keeps them idle."),
        coo: L("Capacity is cut {eta}, new tanks included.", "Tanks ordered now start brewing next round, and the squeeze cuts them by the same share. Brewing operations softens the cut, one round after you fund it."),
        cmo: L("Every brewery has less to sell {eta}.", "Supply falls {eta} for every brewery. A higher price earns more per drink but turns some shoppers away."),
        chro: L("Taproom community softens capacity shocks.", "Taproom community helps soften the capacity cut {eta}. Spending on it counts one round after you make it."),
        member: L("A capacity cut hits {eta}.", "Every brewery runs below capacity {eta}. Brewing operations and Taproom community soften the cut, one round after you fund them. New tanks are cut too."),
      },
    },
  },
  demand_slump: {
    title: "Recession",
    summary: { announced: "demand will drop {eta}", hits: "demand drops in every category this round" },
    headline: { announced: "A recession is coming", hits: "The recession is here" },
    subline: { announced: "Expected {eta}. Demand will drop in every category.", hits: "Demand drops in every category this round. Shoppers buy less." },
    seats: {
      announced: {
        ceo: L("Demand drops in every category {eta}.", "Demand drops in every category {eta}, for two rounds. Every brewery sells fewer drinks at any given price."),
        cfo: L("Revenue likely drops {eta}.", "Revenue likely drops {eta}, for two rounds. Lower profit can also shrink what the bank will lend."),
        coo: L("Fewer drinks sell {eta}.", "Fewer drinks sell {eta}, for two rounds. Tanks ordered now start brewing next round. Every tank costs upkeep each round, used or not."),
        cmo: L("Shoppers buy less {eta}.", "Shoppers buy less in every category {eta}. How they weigh price, quality and brand does not change."),
        chro: L("No direct hit on your levers.", "No direct hit on your levers. Salaries stay the same while sales fall."),
        member: L("Demand drops {eta}.", "Demand drops in every category {eta}, for two rounds. Shoppers buy less but still weigh price, quality and brand the same way."),
      },
      hits: {
        ceo: L("Fewer shoppers in every category.", "Demand is down in every category this round. Shoppers still weigh price, quality and brand the same way."),
        cfo: L("Revenue is down this round.", "Revenue falls this round, while fixed costs, salaries and interest stay the same."),
        coo: L("Some tanks may sit idle.", "Some of your tanks may sit idle this round. Every tank costs upkeep each round, used or not."),
        cmo: L("Shoppers buy less this round.", "Shoppers buy less in every category this round. They still weigh price, quality and brand the same way."),
        chro: L("Payroll stays the same through a two-round dip.", "The slump lasts two rounds, and salaries stay the same while sales fall. Layoffs cut payroll but lower Taproom community and the rest of the crew's morale."),
        member: L("Demand is down in every category.", "Shoppers buy less in every category this round. Fixed costs, salaries and interest stay the same."),
      },
    },
  },
  craft_wave: {
    title: "Festival season",
    summary: { announced: "demand is expected to rise in every category", hits: "demand rises in every category this round" },
    headline: { announced: "Festival season is coming", hits: "Festival season is here" },
    subline: { announced: "Expected {eta}. Tourists and festivals lift demand in every category.", hits: "Festivals and tourists lift demand in every category this round. Every brewery can sell more, up to what it can brew." },
    seats: {
      announced: {
        ceo: L("Demand rises in every category {eta}.", "Demand rises in every category {eta}, for two rounds. Sales are capped by what you can brew. Tanks ordered now start brewing next round."),
        cfo: L("Revenue can rise {eta}.", "Sales can rise {eta}, for two rounds, up to what your tanks can brew."),
        coo: L("Demand rises {eta}; new tanks take a round.", "Demand rises {eta}, for two rounds. Tanks ordered now start brewing next round. Every tank costs upkeep each round, used or not."),
        cmo: L("Shoppers buy more {eta}.", "Shoppers buy more in every category {eta}. They still weigh price, quality and brand the same way."),
        chro: L("No direct effect on your levers.", "No direct effect on your levers. Demand rises {eta}, for two rounds."),
        member: L("Demand rises {eta}.", "Demand rises in every category {eta}, for two rounds. Sales are capped by what you can brew. Tanks ordered now arrive next round."),
      },
      hits: {
        ceo: L("Everyone can sell more, up to capacity.", "Demand is up in every category this round. Sales are capped by what you can brew."),
        cfo: L("Revenue can rise this round.", "Revenue can rise this round. The lift lasts two rounds, not for good."),
        coo: L("Demand may outrun what you can brew.", "Demand may be more than you can brew this round. Shoppers you can't serve may buy from a rival. You choose how your tanks are split across categories."),
        cmo: L("Shoppers buy more this round.", "Shoppers buy more in every category this round. A higher price earns more per drink but turns some shoppers away."),
        chro: L("No direct effect on your levers.", "No direct effect on your levers. Salaries stay the same while sales rise."),
        member: L("Demand rises this round.", "Every category can sell more this round, up to what each brewery can brew."),
      },
    },
  },
  health_shift: {
    title: "Health & wellness shift",
    summary: { announced: "tastes are turning away from Lagers & Light", hits: "Lagers & Light demand falls this round" },
    headline: { announced: "Tastes are turning", hits: "The wellness shift is here" },
    subline: { announced: "Expected {eta}. Drinkers will buy less Lagers & Light for three rounds.", hits: "Drinkers are buying less Lagers & Light. Demand there stays down while the shift lasts (three rounds in all)." },
    seats: {
      announced: {
        ceo: L("Lagers & Light demand falls {eta}.", "Lagers & Light demand falls {eta} and stays down for three rounds. Craft Premium and Non-Alc / Functional are not affected."),
        cfo: L("Lagers & Light revenue falls {eta}.", "Revenue from Lagers & Light falls {eta}, for three rounds. The other categories are not affected."),
        coo: L("Lagers & Light demand falls {eta}.", "Lagers & Light demand falls {eta}, for three rounds. Tanks ordered now start brewing next round. You choose how tanks are split across categories."),
        cmo: L("Lagers & Light shoppers buy less {eta}.", "Lagers & Light demand falls {eta}, for three rounds. Shoppers who stop buying it do not switch to the other categories."),
        chro: L("No direct hit on your levers.", "No direct hit on your levers. Lagers & Light demand falls {eta}, for three rounds."),
        member: L("Lagers & Light demand falls {eta}.", "Demand for Lagers & Light falls {eta} and stays down for three rounds. The other categories are not affected."),
      },
      hits: {
        ceo: L("Lagers & Light demand is down.", "Lagers & Light demand is down while the shift lasts (three rounds in all). The other categories are not affected."),
        cfo: L("Lagers & Light revenue is down for a while.", "Revenue from Lagers & Light falls while the shift lasts (three rounds in all). The other categories are not affected."),
        coo: L("Lagers & Light tanks may sit idle.", "Tanks set for Lagers & Light may sit partly idle. You choose how tanks are split across categories."),
        cmo: L("Lagers & Light shoppers buy less.", "Lagers & Light shoppers buy less this round. Shoppers who stop buying it do not switch to the other categories."),
        chro: L("No direct hit on your levers.", "No direct hit on your levers. Lagers & Light demand is down while the shift lasts."),
        member: L("Lagers & Light demand is down.", "Lagers & Light demand falls this round and stays down while the shift lasts. The other categories are not affected."),
      },
    },
  },
  na_moment: {
    title: "Non-alcoholic goes mainstream",
    summary: { announced: "Non-Alc / Functional demand is about to jump", hits: "Non-Alc / Functional demand jumps this round" },
    headline: { announced: "Non-alcoholic is about to go mainstream", hits: "Non-alcoholic has gone mainstream" },
    subline: { announced: "Expected {eta}. Demand for Non-Alc / Functional jumps and stays up for three rounds.", hits: "Demand for Non-Alc / Functional jumps this round and stays up while the boom lasts (three rounds in all)." },
    seats: {
      announced: {
        ceo: L("Non-Alc / Functional demand jumps {eta}.", "Non-Alc / Functional demand jumps {eta} and stays up for three rounds. Only breweries selling in that category gain from it."),
        cfo: L("Non-Alc / Functional revenue can rise {eta}.", "Demand for Non-Alc / Functional jumps {eta}, for three rounds. Only breweries selling there gain revenue from it."),
        coo: L("Non-Alc / Functional demand jumps {eta}.", "Non-Alc / Functional demand jumps {eta}, for three rounds. Tanks ordered now start brewing next round. You choose how tanks are split across categories."),
        cmo: L("More shoppers want Non-Alc / Functional {eta}.", "Demand for Non-Alc / Functional jumps {eta}, for three rounds. Shoppers there still weigh price, quality and brand the same way."),
        chro: L("No direct effect on your levers.", "No direct effect on your levers. Non-Alc / Functional demand jumps {eta}, for three rounds."),
        member: L("Non-Alc / Functional demand jumps {eta}.", "Demand for Non-Alc / Functional jumps {eta} and stays up for three rounds. Only breweries selling there gain from it."),
      },
      hits: {
        ceo: L("Non-Alc / Functional demand is up.", "Non-Alc / Functional demand is up while the boom lasts (three rounds in all). Only breweries selling there gain from it."),
        cfo: L("Non-Alc / Functional revenue can rise.", "Revenue from Non-Alc / Functional can rise this round for breweries selling there. The lift lasts three rounds in all."),
        coo: L("Non-Alc / Functional demand is up.", "Non-Alc / Functional demand is up this round. Tanks ordered now start brewing next round. You choose how tanks are split across categories."),
        cmo: L("More shoppers want Non-Alc / Functional.", "More shoppers want Non-Alc / Functional this round. A higher price there earns more per drink but turns some shoppers away."),
        chro: L("No direct effect on your levers.", "No direct effect on your levers. Non-Alc / Functional demand is up while the boom lasts."),
        member: L("Non-Alc / Functional demand jumps.", "Demand for Non-Alc / Functional jumps this round and stays up while the boom lasts. Only breweries selling there gain from it."),
      },
    },
  },
};

const FALLBACK: ShockCopy = {
  title: "Market disruption",
  summary: { announced: "a market disruption is expected", hits: "the market is disrupted this round" },
  headline: { announced: "A disruption is coming", hits: "A market disruption has hit" },
  subline: { announced: "Expected {eta}.", hits: "It affects every brewery this round." },
  seats: {
    announced: Object.fromEntries(["ceo", "cfo", "coo", "cmo", "chro", "member"].map((r) => [r, L("A disruption hits {eta}.", "A market disruption hits {eta}. The results page will show what it changed.")])) as SeatCopy,
    hits: Object.fromEntries(["ceo", "cfo", "coo", "cmo", "chro", "member"].map((r) => [r, L("The market is disrupted this round.", "A market disruption is in effect this round. The results page will show what it changed.")])) as SeatCopy,
  },
};

/** Stable identity for a shock across the announced → hits transition. */
export const shockKey = (s: ShockSignal): string => `${s.typeId}:${s.round}:${s.target}${s.region ? `:${s.region}` : ""}`;

/** A regional shock (a drought strikes one market) only touches firms that PRODUCE there, scaled by
 *  that share (`exposure`, same factor as the resolver). Spared firms get their own seat lines. */
const pctOf = (x: number) => `${Math.round(x * 100)}%`;
function exposureLine(label: string, exposure: number | undefined): string {
  if (exposure == null) return "";
  if (exposure <= 0) return ` None of your production is there, so you're spared.`;
  if (exposure >= 0.995) return ` All of your production is there.`;
  return ` About ${pctOf(exposure)} of your production is there, so you take that share of the hit.`;
}
/** Worded for either phase: a spared firm reads the same line when the drought is announced and when it hits. */
const spared = (label: string): Record<CopyRole, SeatLine> => ({
  ceo: L(`You're spared. None of your production is in ${label}.`, `All your tanks are outside ${label}, so this cost spike skips you. Rivals brewing there pay more per drink.`),
  cfo: L("No cost hit for you.", `Your unit cost holds. Rivals brewing in ${label} pay more to brew each drink.`),
  coo: L(`Your tanks are outside ${label}. Unit cost holds.`, `Your unit cost holds. A regional shortage hits each brewery in proportion to how much it brews in ${label}.`),
  cmo: L(`Rivals brewing in ${label} pay more per drink.`, `Rivals brewing in ${label} pay more per drink. Your costs do not change.`),
  chro: L("No hit on your levers or your costs.", "No hit on your levers or your costs."),
  member: L(`You're spared. None of your production is in ${label}.`, `All your tanks are outside ${label}, so your unit cost holds. Rivals brewing there pay more per drink.`),
});
export const shockPhase = (s: ShockSignal): WirePhase => (s.active ? "hits" : "announced");

export function eventCopy(shock: ShockSignal, role: string | null | undefined, view: GameView): WireEvent {
  const c = COPY[shock.typeId] ?? FALLBACK;
  const phase = shockPhase(shock);
  const r: CopyRole = (["ceo", "cfo", "coo", "cmo", "chro"] as const).includes(role as SeatRole) ? (role as SeatRole) : "member";
  const away = Math.max(shock.roundsAway, 0);
  const fireRound = shock.round + 1; // engine rounds are 0-based; the UI counts from 1
  const eta = phase === "hits" ? "now" : away <= 0 ? "when this round closes" : away === 1 ? "next round" : `in about ${away} rounds`;
  const fill = (s: string) => s.replace(/\{eta\}/g, eta);
  const regional = shock.region ? marketName(shock.region, shock.regionLabel) : null; // the City View's name for it
  const share = regional ? (shock.exposure ?? 1) : 1;
  const line = regional && shock.exposure != null && shock.exposure <= 0 ? spared(regional)[r] : c.seats[phase][r];
  const sl = typeof line === "function" ? line(view, eta, share, phase) : line;
  const subline = regional
    ? (phase === "hits" ? `It hits breweries producing in ${regional} this round.` : `Expected {eta}, for breweries producing in ${regional}.`) + exposureLine(regional, shock.exposure)
    : c.subline[phase];
  const curRound = Math.min(view.round + 1, view.nRounds);
  return {
    key: shockKey(shock),
    phase,
    tone: phase === "hits" ? "red" : "amber",
    tag: phase === "hits" ? "HITTING NOW" : away <= 0 ? "THIS ROUND" : away === 1 ? "NEXT ROUND" : `IN ${away} ROUNDS`,
    when: phase === "hits" || away <= 0 ? `ROUND ${phase === "hits" ? curRound : fireRound}` : `~ROUND ${fireRound}`,
    kicker: phase === "hits" ? `ON THE WIRE · ROUND ${curRound} · HITTING NOW` : "ON THE WIRE · ANNOUNCED",
    scope: regional ? `${regional.toUpperCase()} ONLY` : shock.target === "all" ? "INDUSTRY-WIDE" : (SEG_LABEL[shock.target] ?? String(shock.target)).toUpperCase(),
    title: c.title,
    summary: fill(c.summary[phase]) + (regional ? ` (${regional} producers)` : ""),
    headline: c.headline[phase],
    subline: fill(subline),
    short: fill(sl.short),
    long: fill(sl.long),
  };
}
