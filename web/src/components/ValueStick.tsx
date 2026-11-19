/**
 * The value stick on screen (11-16; the U4 lecture's stick, redesigned from Devin's review the same day). Per category,
 * last quarter: price and cost from the firm's books, and the two ends a firm can only estimate. WTP stays a "?" until
 * the firm buys market research; the survey then gives the typical shopper's WTP and the range covering the middle half
 * of shoppers, drawn as a whisker beside the stick, so the price visibly cuts through it: the shoppers above it are the
 * ones who buy. WTS is suppliers' need (brewing cost less the margin a supplier keeps) plus the job-market rate for
 * staff, labelled est. 11-18 (`crewSplit`): brewing cost splits into ingredients and crew, and every staff need is the
 * going pay × the Taproom-community factor, said in one plain line. Numbers come from the engine (`projectValueStick`); this file only draws them. Colours are the
 * 11-09 chart tokens (validated as a set, both themes); every band is also named in text, with a table twin.
 */
import type { ValueStickRow, ValueStickView } from "drinkwars-engine";
import { SEG_LABEL, fmt } from "../labels.js";
import { Card, Eyebrow } from "./ui.js";
import { InfoDot } from "./InfoDot.js";

const BAND = {
  customer: { color: "var(--chart-caught)", label: "Customer surplus (typical shopper)", sub: "what the typical shopper gains over the price" },
  firm: { color: "var(--chart-own)", label: "Firm margin", sub: "what the firm keeps per drink" },
  supplier: { color: "var(--chart-stock)", label: "Supplier & employee surplus (est.)", sub: "what suppliers and staff get above their minimum" },
} as const;
const nameOf = (id: string) => (id === "all" ? "All categories" : SEG_LABEL[id] ?? id);
const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;
const dime = (n: number) => `${n < 0 ? "−" : ""}$${(Math.round(Math.abs(n) * 10) / 10).toFixed(2)}`; // an estimate, read to the dime
const signed = (n: number) => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toFixed(2)}`;
/** 11-18: what the Taproom community does to staff need, in one sentence. */
const needLine = (nf: number) => (Math.abs(nf - 1) < 0.005 ? "Staff need the going pay."
  : nf < 1 ? `Your Taproom community is strong, so staff would stay for about ${Math.round((1 - nf) * 100)}% less than the going pay.`
  : `Your Taproom community is below where it started, so staff need about ${Math.round((nf - 1) * 100)}% more than the going pay to stay.`);
const move = (n: number) => (Math.abs(n) < 0.005 ? "unchanged" : `${n > 0 ? "▲ up" : "▼ down"} ${usd(Math.abs(n))}`);

/** One stick, drawn to a shared $ scale so categories compare by height. */
function Stick({ r, top, floor, h, w, compact, showWtp }: { r: ValueStickRow; top: number; floor: number; h: number; w: number; compact?: boolean; showWtp: boolean }) {
  const barW = compact ? 22 : 34, x0 = compact ? 14 : 18, pad = 10, plot = h - pad * 2;
  // the stick's meaning is the distance between its levels, so the scale starts just below the lowest WTS, not at $0
  const y = (v: number) => pad + plot * (1 - (Math.max(floor, Math.min(top, v)) - floor) / (top - floor));
  const wtp = showWtp ? r.wtp : null;
  const levels: { k: string; v: number }[] = [
    ...(wtp ? [{ k: "WTP ≈", v: wtp.typical }] : []),
    { k: "Price", v: r.price }, { k: "Cost", v: r.cost }, { k: "WTS ≈", v: r.wts },
  ];
  const gap = compact ? 11 : 13;
  const unknownTop = r.price + (top - r.price) * 0.75;
  const placed = [...levels].sort((a, b) => b.v - a.v).map((m) => ({ text: `${m.k} ${m.k.endsWith("≈") ? dime(m.v) : usd(m.v)}`, v: m.v, ly: y(m.v) }));
  if (!wtp) placed.unshift({ text: "WTP ?", v: unknownTop, ly: (y(r.price) + y(unknownTop)) / 2 });
  for (let i = 1; i < placed.length; i++) if (placed[i].ly - placed[i - 1].ly < gap) placed[i].ly = placed[i - 1].ly + gap;
  const band = (k: keyof typeof BAND, hi: number, lo: number) => {
    if (!(hi - lo > 0.004)) return null;
    const y1 = y(hi) + 1, y2 = y(lo) - 1; // a 2px surface gap between bands
    return <rect key={k} x={x0} y={y1} width={barW} height={Math.max(1, y2 - y1)} rx={2} fill={BAND[k].color}><title>{`${BAND[k].label}: ${usd(hi - lo)} a drink — ${BAND[k].sub}`}</title></rect>;
  };
  const desc = `${nameOf(r.id)}: price ${usd(r.price)}, cost ${usd(r.cost)}, WTS about ${dime(r.wts)}, ${wtp ? `typical shopper's WTP about ${dime(wtp.typical)}` : "WTP unknown"}`;
  const bottomLabel = placed.reduce((m, p) => Math.max(m, p.ly), 0);
  return (
    <svg width={w} height={Math.max(h, bottomLabel + 8)} role="img" aria-label={desc} className="block overflow-visible">
      {/* the unknown top: a dashed outline with a ? */}
      {!wtp && (
        <g>
          <rect x={x0} y={y(unknownTop)} width={barW} height={Math.max(8, y(r.price) - y(unknownTop) - 2)} rx={3} fill="none" stroke="var(--color-inksoft)" strokeOpacity={0.55} strokeDasharray="4 3" />
          <text x={x0 + barW / 2} y={(y(r.price) + y(unknownTop)) / 2 + 5} textAnchor="middle" fontSize={compact ? 12 : 15} fontWeight={700} fill="var(--color-inksoft)">?</text>
        </g>
      )}
      {wtp && band("customer", wtp.typical, r.price)}
      {band("firm", r.price, r.cost)}
      {band("supplier", r.cost, r.wts)}
      {/* shoppers' WTP: the middle half as a whisker, the typical shopper as a dot */}
      {wtp && (
        <g>
          <title>{`Middle half of shoppers: WTP ${dime(Math.max(0, wtp.lo))}–${dime(wtp.hi)}`}</title>
          <line x1={x0 - 8} x2={x0 - 8} y1={y(wtp.hi)} y2={y(wtp.lo)} stroke={BAND.customer.color} strokeWidth={3} strokeLinecap="round" />
          <circle cx={x0 - 8} cy={y(wtp.typical)} r={4} fill={BAND.customer.color} stroke="var(--color-panel)" strokeWidth={2} />
        </g>
      )}
      {[r.price, r.cost].map((v, i) => <line key={i} x1={x0 - 3} x2={x0 + barW + 3} y1={y(v)} y2={y(v)} stroke="var(--color-ink)" strokeWidth={i === 0 ? 2 : 1} />)}
      <line x1={x0} x2={x0 + barW} y1={y(r.wts)} y2={y(r.wts)} stroke="var(--color-ink)" strokeWidth={1} strokeDasharray="3 2" />
      {placed.map((m) => (
        <g key={m.text}>
          {m.text !== "WTP ?" && <line x1={x0 + barW + 3} x2={x0 + barW + 9} y1={y(m.v)} y2={m.ly} stroke="var(--color-line2)" />}
          <text x={x0 + barW + 11} y={m.ly + 3.5} fontSize={compact ? 9.5 : 11} fill={m.text === "WTP ?" ? "var(--color-inksoft)" : "var(--color-ink)"} className="tnum">{m.text}</text>
        </g>
      ))}
    </svg>
  );
}

/** Plain lines under a stick: what the firm keeps, and value created once the survey makes it measurable. */
function Readout({ r, showWtp }: { r: ValueStickRow; showWtp: boolean }) {
  const wtp = showWtp ? r.wtp : null;
  return (
    <div className="grid gap-0.5 text-[0.72rem] leading-snug">
      <div><span className="text-inksoft">You keep</span> <b className="tnum">{usd(r.price - r.cost)}</b> <span className="text-inksoft">a drink</span></div>
      {wtp ? (<>
        <div><span className="text-inksoft">Value created ≈</span> <b className="tnum">{dime(wtp.typical - r.wts)}</b> <span className="text-inksoft">(typical shopper)</span></div>
        <div className="text-inksoft">Middle half of shoppers: <span className="whitespace-nowrap">{dime(Math.max(0, wtp.lo))}–{dime(wtp.hi)}</span></div>
        {wtp.typical < r.price && <div className="text-inksoft">Your price is above the typical shopper's WTP. You sell to the shoppers who value your drink more.</div>}
      </>) : <div className="text-inksoft">WTP is unknown. Market research gives a survey estimate.</div>}
    </div>
  );
}

export function ValueStickCard({ vs, compact = false, researchOn = false }: { vs: ValueStickView | null | undefined; compact?: boolean; researchOn?: boolean }) {
  if (!vs || !vs.rows.length) {
    return compact ? null : (
      <Card>
        <Eyebrow>Value stick</Eyebrow>
        <div className="mt-1 text-sm text-inksoft">The value stick appears once a round has resolved with drinks sold.</div>
      </Card>
    );
  }
  const showWtp = researchOn && vs.surveyed;
  const rows = compact ? vs.rows.slice(0, 3) : [...vs.rows, ...(vs.all ? [vs.all] : [])];
  const hiV = Math.max(...rows.flatMap((r) => [r.price * 1.35, r.cost, ...(showWtp && r.wtp ? [r.wtp.hi] : [])]), 0.01);
  const loV = Math.min(...rows.map((r) => r.wts));
  const floor = Math.max(0, loV - (hiV - loV) * 0.12), top = hiV + (hiV - loV) * 0.04;
  const h = compact ? 118 : 200, w = compact ? 118 : 190;
  const legend = (
    <div className={`flex flex-wrap gap-x-3 gap-y-1 ${compact ? "text-[0.64rem]" : "text-[0.7rem]"} text-inksoft`}>
      {(Object.keys(BAND) as (keyof typeof BAND)[]).filter((k) => showWtp || k !== "customer").map((k) => (
        <span key={k} className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: BAND[k].color }} />{BAND[k].label}</span>
      ))}
      {showWtp && <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-[3px] rounded" style={{ background: BAND.customer.color }} />Shoppers' WTP: middle half; dot = typical</span>}
    </div>
  );
  if (compact) {
    return (
      <div data-dw="value-stick-compact">
        <div className="flex flex-wrap gap-x-1 gap-y-2">
          {rows.map((r) => (
            <figure key={r.id} className="m-0 min-w-0">
              <figcaption className="mb-0.5 text-[0.7rem] font-bold text-ink">{nameOf(r.id)}</figcaption>
              <Stick r={r} top={top} floor={floor} h={h} w={w} compact showWtp={showWtp} />
            </figure>
          ))}
        </div>
        <div className="mt-1.5">{legend}</div>
        {!showWtp && <div className="mt-1 text-[0.68rem] leading-snug text-faint">WTP is unknown until you buy market research.</div>}
      </div>
    );
  }
  const first = vs.rows[0];
  const stocks = vs.stocks;
  const stockLine = (label: string, s: [number, number] | null) => (s ? `${label} ${s[0].toFixed(1)} → ${s[1].toFixed(1)}${Math.abs(s[1] - s[0]) < 0.05 ? "" : s[1] > s[0] ? " ▲" : " ▼"}` : null);
  return (
    <Card>
      <div data-dw="value-stick" className="grid gap-3">
        <div className="flex items-center gap-1.5">
          <Eyebrow>Value stick · per drink, last quarter</Eyebrow>
          <InfoDot title="Reading the value stick">
            <b>WTP</b> (willingness to pay) is the most a shopper would pay for your drink rather than not buy one. It differs from shopper to shopper, and no one reports it. A survey (market research) estimates the typical shopper's WTP and the range that covers the middle half of shoppers. Surveys are rough: the estimate can be off by around 10%. Your buyers are the shoppers whose WTP is above your price. <b>WTS</b> (willingness to sell) is the least your suppliers and staff would accept.{vs.crewSplit ? " A strong Taproom community lowers what staff need, so the same pay keeps them happier." : ""} <b>Value created</b> is WTP − WTS. The firm keeps price − cost.
          </InfoDot>
        </div>
        <div className="max-w-[70ch] text-[0.74rem] leading-snug text-inksoft">
          Price and cost come from your books. Both ends are estimates. WTP comes from a survey of shoppers when you buy market research.{" "}
          {vs.crewSplit
            ? <>WTS is what your suppliers and staff need. Suppliers keep about {usd(first.supplierMargin * first.unitCost)} of each drink's cost. Your crew's pay is about {Math.round(vs.crewSplit.share * 100)}% of brewing cost{vs.peopleOn ? ", and your named staff are paid on top" : ""}. {needLine(first.needFactor)}</>
            : <>WTS assumes suppliers keep about {Math.round(first.supplierMargin * 100)}% of what you pay them{vs.peopleOn ? ", plus what the job market would pay your staff" : ""}.</>}
          {vs.peopleOn ? " Cost includes staff pay, spread over the drinks you sold." : ""}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-4">
          {rows.map((r) => (
            <figure key={r.id} className="m-0 grid min-w-0 content-start gap-1.5" style={{ width: w }}>
              <figcaption className="text-[0.82rem] font-bold leading-tight text-ink">{nameOf(r.id)}<span className="block text-[0.7rem] font-normal text-inksoft">{fmt.int(r.sold)} sold</span></figcaption>
              <Stick r={r} top={top} floor={floor} h={h} w={w} showWtp={showWtp} />
              <Readout r={r} showWtp={showWtp} />
            </figure>
          ))}
        </div>
        {legend}
        {(first.moved || stocks.quality) && (
          <div data-dw="value-stick-moved" className="grid gap-1 border-t border-line pt-2.5 text-[0.76rem] leading-snug">
            <div className="font-mono text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-inksoft">Since the quarter before</div>
            {first.moved && <div><b>Price:</b> {vs.rows.map((r) => `${nameOf(r.id)} ${move(r.moved?.price ?? 0)}`).join(" · ")}</div>}
            {first.moved && (
              <div><b>Cost per drink:</b> {move(first.moved.cost)}{first.moved.costParts.length > 0 && <span className="text-inksoft">. Biggest moves: {[...first.moved.costParts].sort((a, b) => Math.abs(b.dollars) - Math.abs(a.dollars)).slice(0, 2).map((p) => `${p.label.toLowerCase()} ${signed(p.dollars)}`).join(", ")}</span>}</div>
            )}
            {stocks.quality && <div><b>What moves WTP:</b> {[stockLine("quality stock", stocks.quality), stockLine("brand stock", stocks.brand)].filter(Boolean).join(" · ")}<span className="text-inksoft">. Both build with spending and wear down without it.</span></div>}
          </div>
        )}
        <details className="text-[0.74rem]">
          <summary className="cursor-pointer font-mono text-[0.62rem] font-semibold uppercase tracking-wide text-inksoft">Numbers</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full tnum">
              <caption className="sr-only">Value stick per drink, last quarter</caption>
              <thead>
                <tr className="text-left text-inksoft">
                  <th scope="col" className="py-1 pr-2 font-normal">Category</th>
                  {["Price", "Cost", "WTS (est.)", "You keep", "Supplier & staff surplus (est.)", "Typical WTP (survey)", "Middle half of shoppers"].map((x) => <th key={x} scope="col" className="py-1 pr-2 text-right font-normal">{x}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const wtp = showWtp ? r.wtp : null;
                  return (
                    <tr key={r.id} className="border-t border-line">
                      <th scope="row" className="py-1 pr-2 text-left font-normal">{nameOf(r.id)}</th>
                      {[usd(r.price), usd(r.cost), dime(r.wts), usd(r.price - r.cost), dime(r.cost - r.wts), wtp ? dime(wtp.typical) : "—", wtp ? `${dime(Math.max(0, wtp.lo))}–${dime(wtp.hi)}` : "—"].map((v, i) => <td key={i} className="py-1 pr-2 text-right">{v}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {vs.crewSplit
              ? <div className="mt-2 text-inksoft">Cost = ingredients {usd(first.unitCost - first.crew)} + crew {usd(first.crew)}{vs.peopleOn ? ` + staff ${usd(first.staff)}` : ""} a drink. WTS ≈ suppliers' need {dime(first.unitCost - first.crew - first.supplierMargin * first.unitCost)} + crew need {dime(first.crew * first.needFactor)}{vs.peopleOn ? ` + staff need ${dime(first.staffMarket * first.needFactor)}` : ""}.</div>
              : vs.peopleOn && <div className="mt-2 text-inksoft">Cost = brewing {usd(first.unitCost)} + staff {usd(first.staff)} a drink. WTS ≈ suppliers' need {dime(first.unitCost * (1 - first.supplierMargin))} + the job-market rate for the same staff, {usd(first.staffMarket)} a drink.</div>}
          </div>
        </details>
      </div>
    </Card>
  );
}
