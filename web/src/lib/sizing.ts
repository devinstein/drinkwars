import type { MarketSizingView } from "drinkwars-engine";
import { SEG_LABEL, marketName } from "../labels.js";

/** DW-084 · What last quarter's sell-outs say, in one place for the COO card, the tank card and the
 *  Market size card. A firm can turn away its own shoppers in one category (or market) while tanks stand
 *  idle — or sell to rivals' turned-away shoppers — in another: then its capacity was split wrong, and
 *  moving it fixes what more tanks would only paper over. Only the NET shortfall argues for building. */
export interface SellOutRead {
  turned: number; // picked you, found you sold out (gross)
  caught: number; // rivals' shoppers you served with room you had elsewhere
  idle: number; // capacity allotted somewhere that brewed nothing (0 from a pre-DW-084 result)
  shiftable: number; // idle + caught: what moving capacity could point at the sold-out categories
  net: number; // turned − shiftable, floored at 0: the part only more tanks (or a higher price) close
  short: string[]; // where you sold out — categories, or markets when the split was geographic
  spare: string[]; // where you had room — idle tanks, or sales to rivals' overflow
}

export function readSellOuts(s: MarketSizingView): SellOutRead {
  type X = { key: string; name: string; turnedAway: number; room: number };
  const label = (xs: X[], k: "turnedAway" | "room") =>
    xs.filter((x) => x[k] >= 0.5 && x[k] > (k === "turnedAway" ? x.room : x.turnedAway)).sort((a, b) => b[k] - a[k]).map((x) => x.name);
  const cats: X[] = s.cats.map((c) => ({ key: c.id, name: SEG_LABEL[c.id] ?? c.id, turnedAway: c.turnedAway, room: c.caught + (c.idle ?? 0) }));
  const mkts: X[] = s.rows.filter((r) => r.youSell).map((r) => ({ key: r.id, name: marketName(r.id, r.label), turnedAway: r.turnedAway, room: r.caught + (r.idle ?? 0) }));
  // Name the axis the imbalance runs along: categories first (the allocation divider), markets when the
  // categories agree but the markets don't (the market split).
  const byCat = { short: label(cats, "turnedAway"), spare: label(cats, "room") };
  const byMkt = { short: label(mkts, "turnedAway"), spare: label(mkts, "room") };
  const axis = byCat.short.length && byCat.spare.length ? byCat : byMkt.short.length && byMkt.spare.length ? byMkt : byCat.short.length ? byCat : byMkt;
  const idle = s.idle ?? 0;
  const shiftable = s.caught + idle;
  return { turned: s.turnedAway, caught: s.caught, idle, shiftable, net: Math.max(0, s.turnedAway - shiftable), short: axis.short, spare: axis.spare };
}

/** "593 units stood idle; 7,668 went to rivals' shoppers" — the room a firm had, in its two kinds. */
export const roomNote = (x: SellOutRead, int: (n: number) => string): string =>
  [x.idle >= 0.5 ? `${int(x.idle)} units stood idle` : null, x.caught >= 0.5 ? `${int(x.caught)} went to rivals' shoppers` : null].filter(Boolean).join("; ");

/** "Mass", "Mass and Niche", "Mass, Niche and Craft". */
export const listOf = (xs: string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** 11-06 playtest · this quarter's tanks against last quarter's demand on the firm. The sell-out read looks
 *  back, but tanks ordered earlier land at the coming resolve: a firm that turned shoppers away can already be
 *  brewing on twice what it sold, and the cards kept asking for more. `demand` = shoppers who picked the firm
 *  first + rivals' sold-out shoppers it served; `util` = what this quarter's tanks run at if that demand
 *  repeats; `covers` = enough for all of it; `ample` = under 70%, the line the utilization card calls idle. */
export interface TankFit { demand: number; util: number; idle: number; covers: boolean; ample: boolean }
export function tankFit(s: Pick<MarketSizingView, "som" | "caught">, capThis: number): TankFit {
  const demand = Math.max(0, s.som + s.caught);
  const util = capThis > 0 ? Math.min(1, demand / capThis) : 1;
  return { demand, util, idle: Math.max(0, capThis - demand), covers: demand > 0 && capThis >= demand, ample: demand > 0 && capThis > 0 && demand / capThis < 0.7 };
}
