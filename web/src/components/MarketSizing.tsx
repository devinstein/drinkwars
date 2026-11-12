import type { MarketSizingView } from "drinkwars-engine";
import { fmt, marketName } from "../labels.js";
import { Card, Eyebrow } from "./ui.js";
import { InfoDot } from "./InfoDot.js";
import { listOf, readSellOuts, roomNote } from "../lib/sizing.js";

/** DW-084 · TAM ⊇ SAM ⊇ SOM for the last quarter, and which lever each gap belongs to. Sprint 2's screens
 *  showed one "first-choice demand" figure that mixed regions a firm had never entered with shoppers it
 *  turned away, and the COO card read the whole of it as a case for tanks. Only the last gap is. */
export function MarketSizing({ s }: { s: MarketSizingView }) {
  const share = (a: number, b: number) => (b > 0 ? fmt.pct(a / b) : "—");
  const tiers = [
    { k: "TAM", label: "every shopper, every open market and category", n: s.tam, of: "", color: "var(--color-line2)" },
    { k: "SAM", label: "in the markets you sell in, for the categories you stock", n: s.sam, of: `${share(s.sam, s.tam)} of TAM`, color: "var(--color-gold)" },
    { k: "SOM", label: "picked you first", n: s.som, of: `${share(s.som, s.sam)} of SAM`, color: "var(--color-copper)" },
  ];
  const outside = Math.max(0, s.tam - s.sam);
  const nobody = Math.max(0, s.sam - s.som - s.rivals);
  const so = readSellOuts(s);
  // Sold out somewhere while capacity stood idle (or served rivals' overflow) elsewhere: moving it closes up to
  // `shiftable`; only the rest is a case for tanks. The line quantifies both — "most of it" was once hard-coded.
  const room = so.turned >= 0.5 && so.shiftable >= 0.5;
  const toward = so.short.length ? ` toward ${listOf(so.short)}` : "";
  return (
    <Card>
      <div className="flex items-center gap-1.5">
        <Eyebrow>Market size · TAM · SAM · SOM</Eyebrow>
        <InfoDot title="Three sizes of one market">
          <b>TAM</b> (total addressable market) is everyone who could have bought a drink last quarter: every shopper in every open market, in every category. <b>SAM</b> (serviceable available market) is the part you could reach — the markets you sold in and the categories you stocked there. <b>SOM</b> (serviceable obtainable market) is the part you won: shoppers who picked you first. Each gap is a different problem. Outside the SAM is an expansion question (enter a market, add a category). Inside it, shoppers who chose a rival or no brewery at all are a price, quality and brand question. Only shoppers who picked you and found you sold out are a capacity question.
        </InfoDot>
      </div>
      <div className="mb-3 text-[0.72rem] text-inksoft">Last quarter, in shoppers — one shopper buys one drink a quarter.</div>
      <div className="grid gap-2">
        {tiers.map((t) => (
          <div key={t.k}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0"><b className="font-mono text-[0.72rem] tracking-wide">{t.k}</b> <span className="text-inksoft">{t.label}</span></span>
              <span className="tnum shrink-0 text-ink">{fmt.int(t.n)}{t.of && <span className="ml-1.5 text-[0.7rem] text-inksoft">{t.of}</span>}</span>
            </div>
            <div className="mt-0.5 h-2 w-full overflow-hidden rounded-[2px] border border-line">
              <div className="h-full" style={{ width: `${s.tam > 0 ? Math.min(100, (t.n / s.tam) * 100) : 0}%`, background: t.color }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-1.5 text-[0.76rem] leading-snug">
        {outside >= 0.5 && <div><b className="tnum">{fmt.int(outside)}</b> shoppers sit outside your SAM, in markets you don't sell in or categories you don't stock. <span className="text-inksoft">Reaching them means entering a market or adding a category.</span></div>}
        {s.sam - s.som >= 0.5 && <div>In your SAM, <b className="tnum">{fmt.int(s.rivals)}</b> picked a rival{nobody >= 0.5 && <> and <b className="tnum">{fmt.int(nobody)}</b> bought from no brewery</>}. <span className="text-inksoft">Winning them is price, quality and brand, not tanks.</span></div>}
        {room
          ? <div className="text-brick"><b className="tnum">{fmt.int(so.turned)}</b> picked you and found you sold out{so.short.length ? ` in ${listOf(so.short)}` : ""}, while {so.spare.length ? listOf(so.spare) : "elsewhere you"} had room for <b className="tnum">{fmt.int(so.shiftable)}</b> more ({roomNote(so, fmt.int)}). <span className="text-inksoft">{so.net >= 0.5 ? <>Moving capacity{toward} closes up to {fmt.int(Math.min(so.shiftable, so.turned))} of it; the other {fmt.int(so.net)} is what more tanks — or a higher price — would close.</> : <>Moving capacity{toward} closes it without a single new tank.</>}</span></div>
          : s.turnedAway >= 0.5
            ? <div className="text-brick"><b className="tnum">{fmt.int(s.turnedAway)}</b> picked you and found you sold out{so.short.length ? ` in ${listOf(so.short)}` : ""}. <span className="text-inksoft">This is the only gap more tanks close. A higher price is the other lever.</span></div>
            : s.som > 0 && <div className="text-hop">Every shopper who picked you was served.</div>}
        {s.caught >= 0.5 && !room && <div className="text-inksoft">You also served {fmt.int(s.caught)} shoppers that rivals turned away. Those sales depend on rivals selling out, so they can vanish when rivals add tanks.</div>}
      </div>
      {s.rows.length > 1 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[0.74rem] tnum">
            <thead>
              <tr className="text-left text-inksoft">
                <th className="py-1 pr-2 font-normal">Market</th>
                <th className="py-1 pr-2 text-right font-normal">Shoppers</th>
                <th className="py-1 pr-2 text-right font-normal">In your SAM</th>
                <th className="py-1 pr-2 text-right font-normal">Picked you</th>
                <th className="py-1 pr-2 text-right font-normal">Sold</th>
                <th className="py-1 text-right font-normal">Turned away</th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="py-1 pr-2">{marketName(r.id, r.label)}</td>
                  <td className="py-1 pr-2 text-right">{fmt.int(r.pool)}</td>
                  {r.youSell
                    ? <>
                        <td className="py-1 pr-2 text-right">{fmt.int(r.poolYours)}</td>
                        <td className="py-1 pr-2 text-right">{fmt.int(r.pickedYou)}</td>
                        <td className="py-1 pr-2 text-right">{fmt.int(r.sold)}</td>
                        <td className={`py-1 text-right ${r.turnedAway >= 0.5 ? "text-brick" : "text-inksoft"}`}>{r.turnedAway >= 0.5 ? fmt.int(r.turnedAway) : "—"}</td>
                      </>
                    : <td colSpan={4} className="py-1 text-right text-inksoft">you don't sell here</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
