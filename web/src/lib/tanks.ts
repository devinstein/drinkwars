import { advancePipeline, updateStock } from "drinkwars-engine";
import type { Config, FirmState } from "drinkwars-engine";

/** What the tank stock does over the next two resolves, by the engine's own rule (stocks.ts): each resolve
 *  wears the stock by `depreciation`, then lands the order that has waited `lag` rounds — so the quarter about
 *  to be brewed runs on cap − wear + what lands now, and this round's order comes online only after that.
 *  The Decide form once added this round's order to a single wear and ignored the pipeline: a $2.3M order
 *  placed last quarter never showed on the card, while a carried $3M order showed as landing again. */
export interface TankOutlook {
  wear: number; // units lost to wear at the coming resolve
  landNow: number; // units that come online at the coming resolve (ordered `lag` quarters ago)
  capThis: number; // capacity the coming quarter brews with
  added: number; // units this round's order buys
  wearNext: number; // wear at the resolve after that
  capNext: number; // capacity the quarter after, with this order online (lag 1) or whatever lands then
}
export function tankOutlook(own: Pick<FirmState, "cap" | "pipelines">, cc: Config["capacity"], invest: number): TankOutlook {
  const lag = Math.max(0, cc.lag);
  const step = (cap: number, pipeline: number[], order: number) => {
    const a = advancePipeline(pipeline, lag, Math.max(0, order));
    return { cap: updateStock(cap, cc.depreciation, a.matured, cc.conversion, cc.gain), pipeline: a.pipeline, landed: updateStock(0, cc.depreciation, a.matured, cc.conversion, cc.gain) };
  };
  const s1 = step(own.cap, own.pipelines?.cap ?? [], invest); // the coming resolve
  const s2 = step(s1.cap, s1.pipeline, 0); // the one after, with nothing further ordered
  return { wear: own.cap * cc.depreciation, landNow: s1.landed, capThis: s1.cap, added: updateStock(0, cc.depreciation, Math.max(0, invest), cc.conversion, cc.gain), wearNext: s1.cap * cc.depreciation, capNext: s2.cap };
}

/** The order that holds the tanks level (11-06 playtest). It lands after `lag` quarters, so it offsets the
 *  wear-out of the quarter it lands in, not this one: the card once priced this quarter's wear — "$25,600
 *  holds level" beside "+640 with this order", and "$23,040" for a firm whose tanks were about to triple. */
export const holdOrder = (t: TankOutlook, cc: Pick<Config["capacity"], "lag" | "gain">): number =>
  (cc.lag <= 0 ? t.wear : t.wearNext) / (cc.gain > 0 ? cc.gain : 1);
