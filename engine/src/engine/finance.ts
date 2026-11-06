/**
 * Finance layer (§7): derived three statements, endogenous cost of capital
 * (§7.4), and firm valuation (§7.5). The two invariants (§7.2) — balance sheet
 * balances, and cash-flow reconciles to ΔCash — are enforced here and double as
 * engine self-checks. With inventory disabled (legacy) working-capital change is
 * zero (all-cash sales, no carry). With inventory enabled, carried stock sits on
 * the balance sheet at cost and operating cash flow subtracts ΔInventory — the
 * identities still hold exactly (the WC term is restored, not approximated).
 */
import type { BalanceSheet, CashFlow, CfLines, Config, FirmId, FirmState, OpexLineKey, PnL, PostCloseKey, StockKey } from "../types.js";

export class InvariantError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "InvariantError";
  }
}

export interface FinanceInputs {
  firm: FirmState; // beginning-of-round financial state; stocks already advanced (§13 step 4)
  revenue: number;
  cogs: number;
  invest: { Q: number; B: number; T_emp: number; T_inv: number; T_gov: number; process: number; cap: number };
  financing: { debt_draw: number; debt_repay: number; equity_raise: number; dividend: number };
  extraOpex: number; // §11 formation / breach costs (+ inventory holding cost)
  /** DW-070: what `extraOpex` is made of, per module (resolve sums these into extraOpex in the
   *  same order, so the total is bit-identical). Omit ⇒ one undifferentiated line. Display only. */
  extraOpexLines?: Partial<Record<OpexLineKey, number>>;
  /** DW-070: what `invest.cap` is made of (tanks / facilities / vertical assets). Display only. */
  capexLines?: { tanks?: number; facilities?: number; vertical_assets?: number };
  cashHit: number; // §9 direct shock damage (resilience-mitigated)
  // Inventory (omit / 0 in legacy mode ⇒ WC=0, exactly as before). When carrying
  // stock, COGS is already at weighted-average cost; these add the spoilage write-off
  // and the ΔInventory working-capital term.
  spoilage?: number; // inventory write-off this round
  inventoryValueBegin?: number; // $ cost basis on hand at start of round
  inventoryValueEnd?: number; // $ cost basis carried forward
  spreadReduction?: number; // MOD-B10: reputation lowers the endogenous debt spread
  regBurdenReduction?: number; // MOD-B06: integrated distribution relieves regulatory opex
  disposalProceeds?: number; // MOD-B11 divest: cash from selling a facility — a book-neutral PP&E reduction (cash in = PP&E out)
  round?: number; // current round (needed by MOD-B08 instrument terms)
  instruments?: { draw_convertible: number; draw_rbf: number }; // MOD-B08 draws this round
  equityCap?: number; // DW-071: most investors will fund this round (from equityCapacity); omit ⇒ no cap
  /** DW-083: the financing already priced on the beginning-of-round state by the affordability
   *  guard (finance.affordability_guard). When present it is the round's financing — the orders
   *  were sized against it, so the books must not re-price it on the advanced stocks. */
  grant?: FinancingGrant;
  config: Config;
}

/** DW-083: what the round's financing request actually raises. One function for the engine,
 *  the affordability guard and the Decide form, so "the bank will lend up to $X" is the result. */
export interface FinancingGrant {
  equityAsked: number;
  equityGross: number; // after the DW-071 equity gate
  issueCost: number; // fraction lost to the issue fee
  equityNet: number; // what lands in cash
  repay: number; // debt repayment requested, capped at the debt (item 3 may trim it at close)
  requestedDraw: number;
  creditCapacity: number; // the most the bank will lend this round
  limits: CreditLimits; // v3 audit: the two tests behind creditCapacity, and which one binds
  draw: number; // min(requestedDraw, creditCapacity)
  equityAfter: number; // beginning book equity + equityNet — what the bank lends against
}

/** v3 audit: the bank's two lending tests on one request. `byLeverage` is the §7.4 rule (debt ≤ max_leverage
 *  × equity after this round's raise); `byCashFlow` is finance.cash_flow_lending (debt ≤ multiple × annualized
 *  trailing EBITDA), null when the rule is off or the firm has too little history. `capacity` is the lower. */
export interface CreditLimits {
  capacity: number;
  byLeverage: number;
  byCashFlow: number | null;
  annualEbitda: number | null; // trailing mean × 4, when the cash-flow test ran
  binding: "leverage" | "cash_flow"; // which test sets `capacity` (leverage when they tie, or equity is gone)
}

export interface FinanceOutput {
  pnl: PnL;
  balance_sheet: BalanceSheet;
  cash_flow: CashFlow;
  cost_of_capital: { r_debt: number; coverage: number; leverage: number; credit_rationed: boolean };
  next: {
    cash: number; debt: number; paid_in_capital: number; retained_earnings: number; ppe_book: number;
    convertible_note: { principal: number; drawn_round: number } | null;
    rbf_outstanding: number; rbf_principal: number;
  };
  events: string[]; // MOD-B08 instrument events (conversion, payoff)
}

const EPS = 1e-6;
const fmNum = (n: number): string => Math.round(n).toLocaleString("en-US"); // comma-grouped for event prose

export function regulatoryBurden(tGov: number, c: Config): number {
  const { regulatory_burden_base, regulatory_burden_halfsat } = c.finance;
  return regulatory_burden_base * (regulatory_burden_halfsat / (tGov + regulatory_burden_halfsat));
}

export function equityIssueCost(tInv: number, c: Pick<Config, "finance">): number {
  const cost = c.finance.equity_issue_cost_base + c.finance.equity_issue_cost_tinv_k * Math.max(0, c.finance.tinv_ref - tInv);
  return Math.min(0.9, Math.max(0, cost));
}

/** The covenant's cash test (§8.2): a firm is in breach territory under half the cash-safety line. */
export const covenantCashFloor = (c: Pick<Config, "scoring">): number => c.scoring.cash_safety_threshold * 0.5;
/** DW-083 4(b): the emergency overdraft line on the beginning-of-round state — a fraction of assets (cash +
 *  PP&E + inventory at cost), 0 when the overdraft is off. The books compute the same sum in place. */
export const overdraftLimit = (f: Pick<FirmState, "cash" | "ppe_book"> & { inventory_value?: number }, c: Pick<Config, "finance">): number =>
  c.finance.overdraft ? Math.max(0, c.finance.overdraft.max_fraction_of_assets) * Math.max(0, f.cash + f.ppe_book + Math.max(0, f.inventory_value ?? 0)) : 0;

/** DW-083 item 1: the most the bank will lend this round — the draw that keeps post-financing debt
 *  at or under max_leverage × (beginning book equity + this round's net equity raise). `repay` is
 *  the repayment already netted off the debt. 0 once equity is gone. The arithmetic is the one
 *  buildStatements has always applied, so the form's figure is the engine's. */
export function creditLimits(
  f: Pick<FirmState, "debt" | "paid_in_capital" | "retained_earnings"> & { ebitda_history?: number[] }, c: Pick<Config, "finance">, equityNet = 0, repay = 0,
): CreditLimits {
  const equityAfter = f.paid_in_capital + equityNet + f.retained_earnings;
  const maxNewDebt = c.finance.max_leverage * Math.max(equityAfter, EPS);
  const byLeverage = Math.max(0, maxNewDebt - (f.debt - repay));
  const cf = c.finance.cash_flow_lending;
  const hist = f.ebitda_history ?? [];
  let byCashFlow: number | null = null;
  let annualEbitda: number | null = null;
  if (cf && hist.length >= (cf.min_history_rounds ?? 1) && hist.length > 0) {
    const recent = hist.slice(-(cf.trailing_rounds ?? 4));
    annualEbitda = (recent.reduce((a, x) => a + x, 0) / recent.length) * 4;
    byCashFlow = Math.max(0, cf.ebitda_multiple * Math.max(0, annualEbitda) - (f.debt - repay));
  }
  const capacity = byCashFlow == null ? byLeverage : Math.min(byLeverage, byCashFlow);
  const binding: CreditLimits["binding"] = byLeverage <= 0 ? "leverage" : byCashFlow != null && byCashFlow < byLeverage ? "cash_flow" : "leverage";
  return { capacity, byLeverage, byCashFlow, annualEbitda, binding };
}

export function creditCapacity(
  f: Pick<FirmState, "debt" | "paid_in_capital" | "retained_earnings"> & { ebitda_history?: number[] }, c: Pick<Config, "finance">, equityNet = 0, repay = 0,
): number {
  return creditLimits(f, c, equityNet, repay).capacity;
}

/** Why the bank lends no more than it does — the clause after the dash in CREDIT / CREDIT REFUSED, and the
 *  form's own reason. `whose` = "its" for the news, "your" for the form. */
export function creditReason(lim: CreditLimits, equityAfter: number, c: Pick<Config, "finance">, whose: "its" | "your" = "its"): string {
  const m = c.finance.cash_flow_lending?.ebitda_multiple ?? 0;
  const n = c.finance.cash_flow_lending?.trailing_rounds ?? 4;
  if (lim.capacity > 0) return lim.binding === "cash_flow" ? `debt may not exceed ${m}× annual operating cash flow (EBITDA)` : `debt may not exceed ${c.finance.max_leverage}× equity`;
  if (equityAfter <= 0) return `losses have used up ${whose} equity, and the bank lends against equity`;
  if (lim.binding === "cash_flow") {
    return (lim.annualEbitda ?? 0) <= 0
      ? `the bank lends against operating cash flow, and ${whose === "its" ? "the firm's" : "yours"} has been at or below zero over the last ${n} quarter${n === 1 ? "" : "s"}`
      : `${whose} debt already sits at ${m}× ${whose} annual operating cash flow`;
  }
  return `${whose} debt already sits at ${c.finance.max_leverage}× ${whose} equity`;
}

/** The debt rate before any covenant penalty: risk-free plus a spread that rises with leverage and falls with
 *  investor relations (and reputation), floored at min_spread. The same arithmetic buildStatements prices with;
 *  exported so the affordability guard can reserve this quarter's interest on the state it sees. */
export function debtRate(leverage: number, tInv: number, c: Pick<Config, "finance">, spreadReduction = 0): number {
  let spread =
    c.finance.base_spread +
    c.finance.spread_leverage_k * Math.max(0, leverage - c.finance.leverage_ref) -
    c.finance.spread_tinv_k * (tInv - c.finance.tinv_ref) -
    Math.max(0, spreadReduction); // MOD-B10 reputation discount
  spread = Math.max(c.finance.min_spread ?? 0, spread);
  return c.finance.r_f + spread;
}

/** Price a round's financing request on a firm state (DW-071 equity gate, issue fee, §7.4 credit
 *  rationing). `equityCap` = equityCapacity on the beginning-of-round state (omit ⇒ no gate). */
export function financingGrant(
  f: Pick<FirmState, "debt" | "paid_in_capital" | "retained_earnings" | "T_inv"> & { ebitda_history?: number[] },
  c: Pick<Config, "finance">,
  req: { debt_draw: number; debt_repay: number; equity_raise: number },
  equityCap = Infinity,
): FinancingGrant {
  const issueCost = equityIssueCost(f.T_inv, c);
  const equityAsked = Math.max(0, req.equity_raise);
  const equityGross = Math.min(equityAsked, equityCap);
  const equityNet = equityGross * (1 - issueCost);
  const repay = Math.min(Math.max(0, req.debt_repay), f.debt);
  const limits = creditLimits(f, c, equityNet, repay);
  const cap = limits.capacity;
  const requestedDraw = Math.max(0, req.debt_draw);
  return {
    equityAsked, equityGross, issueCost, equityNet, repay, requestedDraw, creditCapacity: cap, limits,
    draw: Math.min(requestedDraw, cap), equityAfter: f.paid_in_capital + equityNet + f.retained_earnings,
  };
}

export function buildStatements(input: FinanceInputs): FinanceOutput {
  const f = input.firm;
  const c = input.config;
  const cashBegin = f.cash;
  const debtBegin = f.debt;
  const paidBegin = f.paid_in_capital;
  const retainedBegin = f.retained_earnings;
  const ppeBegin = f.ppe_book;

  // --- Financing actions (§13 step 2) ---
  const events: string[] = [];
  // One pricing of the request (DW-083): the affordability guard's beginning-of-round grant when
  // it ran, else priced here on the firm as the books see it (the arithmetic this step always used).
  const grant = input.grant ?? financingGrant(f, c, input.financing, input.equityCap ?? Infinity);
  const { equityAsked, equityGross, equityNet, repay, requestedDraw, draw, equityAfter } = grant;
  // DW-071 equity gate: investors fund at most the cap. The shortfall is simply not raised
  // (no cost, no dilution) and the firm is told why.
  if (equityAsked > equityGross + 0.5) {
    events.push(
      equityGross > 0.5
        ? `EQUITY: investors fund only $${fmNum(equityGross)} of the $${fmNum(equityAsked)} ${f.id} sought — ${Math.round((c.finance.equity_gate?.max_fraction_of_valuation ?? 1) * 100)}% of its valuation is the most they will buy in a quarter`
        : `EQUITY MARKET CLOSED: no investor will fund ${f.id}'s $${fmNum(equityAsked)} raise — its losses have pushed its valuation to zero or below`,
    );
  }
  // Credit rationing (creditCapacity): the draw is cut so post-financing leverage ≤ max_leverage.
  let creditRationed = draw < requestedDraw - EPS;
  // DW-083 item 6: say so in the round's news, like the equity line — it used to surface only as
  // "Credit: Rationed" on the CFO card AFTER the round, too late for a firm the cut had just closed.
  if (requestedDraw > draw + 0.5) {
    events.push(
      draw > 0.5
        ? `CREDIT: the bank lends ${f.id} only $${fmNum(draw)} of the $${fmNum(requestedDraw)} it asked — ${creditReason(grant.limits, equityAfter, c)}`
        : `CREDIT REFUSED: the bank lends ${f.id} nothing of the $${fmNum(requestedDraw)} it asked — ${creditReason(grant.limits, equityAfter, c)}`,
    );
  }

  const debtEff = debtBegin + draw - repay;

  // --- MOD-B08 financial instruments (convertible note + revenue-based financing) ---
  // Both fold into the balance-sheet debt line; their distinct pricing lives here.
  const fi = c.modules?.financialInstruments;
  const fiOn = !!fi?.enabled;
  const round = input.round ?? 0;
  let conv = f.convertible_note ?? null;
  let rbfOut = Math.max(0, f.rbf_outstanding ?? 0);
  let rbfPrin = Math.max(0, f.rbf_principal ?? 0);
  let convDraw = 0;
  let rbfDraw = 0;
  let convInterest = 0;
  let rbfInterest = 0;
  let rbfPrinPaid = 0;
  let convRepaid = 0;
  let convConverted = 0;
  if (fiOn) {
    // Interest accrues on the note balance carried into the round.
    if (conv) convInterest = fi.convertible.rate * conv.principal;
    // RBF: pay a fixed slice of revenue until the obligation is cleared. The slice
    // splits into principal (debt amortization) and fee (interest expense).
    if (rbfOut > EPS) {
      const pay = Math.min(fi.rbf.payment_rate * Math.max(0, input.revenue), rbfOut);
      rbfPrinPaid = Math.min(rbfPrin, pay / fi.rbf.multiple);
      rbfInterest = pay - rbfPrinPaid;
      rbfOut -= pay;
      rbfPrin -= rbfPrinPaid;
      if (rbfOut <= EPS) {
        rbfOut = 0;
        rbfPrin = 0;
        events.push(`FINANCING: ${f.id} pays off its revenue-based financing`);
      }
    }
    // New draws (one instrument of each kind at a time).
    if (!conv && (input.instruments?.draw_convertible ?? 0) > 0) {
      convDraw = Math.min(Math.max(0, input.instruments!.draw_convertible), fi.convertible.max_equity_fraction * Math.max(equityAfter, 0));
      if (convDraw > EPS) conv = { principal: convDraw, drawn_round: round };
      else convDraw = 0;
    }
    if (rbfOut <= EPS && (input.instruments?.draw_rbf ?? 0) > 0) {
      rbfDraw = Math.min(Math.max(0, input.instruments!.draw_rbf), fi.rbf.max_revenue_fraction * Math.max(0, input.revenue));
      if (rbfDraw > EPS) {
        rbfOut = rbfDraw * fi.rbf.multiple;
        rbfPrin = rbfDraw;
      } else rbfDraw = 0;
    }
  }

  // --- Operating result ---
  const gross = input.revenue - input.cogs;
  const spoilage = Math.max(0, input.spoilage ?? 0); // inventory write-off
  const invBegin = Math.max(0, input.inventoryValueBegin ?? 0);
  const invEnd = Math.max(0, input.inventoryValueEnd ?? 0);
  const deltaInventory = invEnd - invBegin; // working-capital change (0 in legacy mode)
  const regulatory = regulatoryBurden(f.T_gov, c) * (1 - Math.min(1, Math.max(0, input.regBurdenReduction ?? 0)));
  const opex =
    Math.max(0, input.invest.Q) +
    Math.max(0, input.invest.B) +
    Math.max(0, input.invest.T_emp) +
    Math.max(0, input.invest.T_inv) +
    Math.max(0, input.invest.T_gov) +
    Math.max(0, input.invest.process) +
    c.finance.fixed_overhead +
    c.capacity.fixed_cost_per_unit * f.cap +
    regulatory +
    Math.max(0, input.extraOpex);
  const depreciation = c.capacity.depreciation * ppeBegin;
  const ebit = gross - opex - spoilage - depreciation;

  // --- Facility disposal (MOD-B11 divest) — book-neutral: cash in == PP&E out, no P&L gain/loss.
  // Clamped to the PP&E available after this round's capex and depreciation so book can't go negative
  // (and the proceeds clamp with it, keeping the swap exactly matched → invariants hold). ---
  const disposal = Math.min(
    Math.max(0, input.disposalProceeds ?? 0),
    Math.max(0, ppeBegin + Math.max(0, input.invest.cap) - depreciation),
  );

  // --- Endogenous cost of capital (§7.4) — leverage counts ALL debt-like balances.
  // Clamped at 10× (deep covenant-breach territory, > 3× the max_leverage cap): with
  // equity near/below zero the raw ratio explodes toward debt/EPS ≈ 1e11, which used
  // to price interest into the quadrillions for insolvent firms and distort every
  // rival's within-round z-scores. A bank prices a broke borrower punitively, not
  // astronomically — the firm still fails, with sane numbers. ---
  const instrDebtNow = (conv?.principal ?? 0) + rbfPrin;
  const leverage = Math.min(10, (debtEff + instrDebtNow) / Math.max(equityAfter, EPS));
  // Floor, not zero (DW-056): a firm with strong investor relations — or high reputation under MOD-B10 —
  // used to clamp the spread to 0 and borrow at the risk-free rate, which made leverage free (a
  // well-connected firm at the 3x cap paid LESS than a debt-free one). A lender's floor is its own funding
  // cost plus something. Legacy configs without min_spread keep the old 0 clamp. (debtRate: the same
  // arithmetic, exported for the affordability guard's interest reserve.)
  let rDebt = debtRate(leverage, f.T_inv, c, input.spreadReduction ?? 0);
  let interest = rDebt * debtEff + convInterest + rbfInterest;
  let coverage = interest > EPS ? ebit / interest : ebit >= 0 ? 999 : 0;
  if (coverage < c.finance.coverage_threshold) {
    // Covenant breach: the bank reprices (bank debt only). "step" charges the whole spread at the
    // threshold — a default-rate provision, and a cliff. "graduated" phases the SAME spread in
    // between the threshold and zero coverage, so missing by a hair costs a hair. Either way the
    // breach itself is binary: `credit_rationed` flags it and the covenant clock starts.
    const thr = c.finance.coverage_threshold;
    const severity = c.finance.coverage_penalty_mode === "graduated" && thr > 0
      ? Math.min(1, (thr - Math.max(0, coverage)) / thr)
      : 1;
    rDebt += c.finance.coverage_penalty_spread * severity;
    interest = rDebt * debtEff + convInterest + rbfInterest;
    coverage = interest > EPS ? ebit / interest : ebit >= 0 ? 999 : 0;
    creditRationed = true;
  }

  const netIncome = ebit - interest;

  // --- DW-083 item 3: a repayment may not take the closing cash below the covenant floor (the
  // dividend has always been cash-capped; repayment was capped only by the debt). Interest above
  // is priced on the planned balance; whatever isn't repaid simply stays owed. Flag off ⇒ repayPaid
  // === repay and every expression below is the pre-DW-083 one, bit for bit. ---
  let repayPaid = repay;
  if (c.finance.repay_cash_cap && repay > 0) {
    const floor = covenantCashFloor(c);
    const cashBeforeRepay =
      cashBegin + (netIncome + depreciation - deltaInventory) - Math.max(0, input.invest.cap) + disposal +
      (draw + equityNet) + convDraw + rbfDraw - rbfPrinPaid - Math.max(0, input.cashHit);
    const room = Math.max(0, cashBeforeRepay - floor);
    if (repay > room) {
      repayPaid = room;
      if (repay - room >= 0.5) {
        events.push(room >= 0.5
          ? `REPAYMENT CUT: ${f.id} repays $${fmNum(room)} of the $${fmNum(repay)} it planned — a repayment may not take cash below the $${fmNum(floor)} covenant floor; the rest stays owed`
          : `REPAYMENT CUT: ${f.id} repays nothing of the $${fmNum(repay)} it planned — its cash would fall below the $${fmNum(floor)} covenant floor; the debt stays owed`);
      }
    }
  }

  // --- Convertible maturity (MOD-B08): repay if the cash is there, else convert ---
  const cashPreMaturity =
    cashBegin + (netIncome + depreciation - deltaInventory) - Math.max(0, input.invest.cap) + disposal +
    (draw - repayPaid + equityNet) + convDraw + rbfDraw - rbfPrinPaid;
  if (fiOn && conv && convDraw === 0 && round >= conv.drawn_round + fi.convertible.term) {
    if (cashPreMaturity >= conv.principal) {
      convRepaid = conv.principal;
      events.push(`FINANCING: ${f.id} repays its convertible note at maturity`);
    } else {
      convConverted = conv.principal;
      events.push(`DILUTION: ${f.id}'s convertible note converts to equity at maturity`);
    }
    conv = null;
  }

  // --- Dividend (capped by available cash; cash tied up in new stock isn't available) ---
  const cashPreDividend = cashPreMaturity - convRepaid;
  const dividend = Math.min(Math.max(0, input.financing.dividend), c.finance.dividend_max_fraction * Math.max(0, cashPreDividend));

  // --- Cash flow (operating subtracts ΔInventory; = 0 in legacy mode) ---
  const operating = netIncome + depreciation - deltaInventory;
  const investing = -Math.max(0, input.invest.cap) + disposal; // capex out, divest proceeds in
  let financing = draw - repayPaid + equityNet - dividend + convDraw + rbfDraw - rbfPrinPaid - convRepaid;
  const cashHit = Math.max(0, input.cashHit);
  let deltaCash = operating + investing + financing - cashHit;
  let cashNext = cashBegin + deltaCash;
  // bank debt carried in firm state (a trimmed repayment leaves the difference owed)
  let debtNext = repayPaid === repay ? debtEff : debtBegin + draw - repayPaid;

  // --- DW-083 item 4(b): a round that closes below zero draws an emergency overdraft — bank debt,
  // so next round prices it on the grid (at that leverage and coverage, near its top) — up to a
  // fraction of the assets the firm began the round with. Short of the limit the firm closes at 0
  // cash and below the line, so only the covenant ends it; past the limit the cash stays negative
  // and exit.ts closes it. Flag off ⇒ nothing here runs. ---
  let overdraft = 0;
  const odCfg = c.finance.overdraft;
  if (odCfg && cashNext < 0) {
    const need = -cashNext;
    const limit = Math.max(0, odCfg.max_fraction_of_assets) * Math.max(0, cashBegin + ppeBegin + invBegin);
    overdraft = Math.min(need, limit);
    financing += overdraft;
    debtNext += overdraft;
    if (overdraft >= need) {
      cashNext = 0;
      deltaCash = -cashBegin;
    } else {
      deltaCash += overdraft;
      cashNext = cashBegin + deltaCash;
    }
    events.push(overdraft >= need
      ? `OVERDRAFT: the bank covers ${f.id}'s $${fmNum(need)} shortfall with an emergency overdraft — it is debt now, priced at the penalty rate`
      : `OVERDRAFT EXHAUSTED: ${f.id} is $${fmNum(need)} short and the bank's emergency line stops at $${fmNum(limit)} (${Math.round(odCfg.max_fraction_of_assets * 100)}% of its assets)`);
  }

  // --- Balance sheet update ---
  const instrDebtNext = (conv?.principal ?? 0) + rbfPrin; // instrument balances (also debt)
  const debtTotal = debtNext + instrDebtNext; // the balance-sheet debt line
  const paidNext = paidBegin + equityNet + convConverted; // conversion = debt → equity
  // The shock cash hit is an extraordinary loss → flows through retained earnings
  // so the balance sheet stays balanced (Assets fell by cashHit; Equity must too).
  const retainedNext = retainedBegin + netIncome - dividend - cashHit;
  const ppeNext = ppeBegin + Math.max(0, input.invest.cap) - depreciation - disposal; // disposal removes book = proceeds

  const assets = cashNext + ppeNext + invEnd;
  const equity = paidNext + retainedNext;

  // --- Invariants (§7.2) — tolerance is RELATIVE at scale (double-precision ulp
  // grows with magnitude; at $1e16 one ulp is ~4, so a fixed 1e-3 would false-fire
  // on float roundoff, not real imbalance) ---
  if (Math.abs(assets - (debtTotal + equity)) > Math.max(1e-3, 1e-9 * Math.abs(assets))) {
    throw new InvariantError(
      `Balance sheet does not balance for ${f.id}: assets=${assets.toFixed(4)} vs L+E=${(debtTotal + equity).toFixed(4)}`,
    );
  }
  if (Math.abs(cashNext - cashBegin - deltaCash) > Math.max(1e-6, 1e-12 * Math.abs(cashNext))) {
    throw new InvariantError(`Cash flow does not reconcile for ${f.id}`);
  }

  // --- DW-070 line items. Display only: each restates a term the totals above already summed,
  // so nothing computed changes; lines sum to their total (tested, test/dw070.test.ts). ---
  const extra = Math.max(0, input.extraOpex);
  const modLines = input.extraOpexLines ?? {};
  // A module line set that does not account for the clamped total (none today: every module
  // cost is ≥ 0) falls back to one line, so the lines can never disagree with `opex`.
  const modSum = Object.values(modLines).reduce((a, v) => a + (v ?? 0), 0);
  const modOk = Object.values(modLines).every((v) => (v ?? 0) >= 0) && Math.abs(modSum - extra) <= Math.max(1e-6, 1e-9 * extra);
  const opex_lines = nonZero<OpexLineKey>({
    quality: Math.max(0, input.invest.Q),
    brand: Math.max(0, input.invest.B),
    community: Math.max(0, input.invest.T_emp),
    investor_relations: Math.max(0, input.invest.T_inv),
    regulator_relations: Math.max(0, input.invest.T_gov),
    operations: Math.max(0, input.invest.process),
    overhead: c.finance.fixed_overhead,
    tank_upkeep: c.capacity.fixed_cost_per_unit * f.cap,
    regulatory,
    ...(modOk ? modLines : { other: extra }),
  });
  const capex = Math.max(0, input.invest.cap);
  const cl = input.capexLines;
  const capOk = !!cl && [cl.tanks, cl.facilities, cl.vertical_assets].every((v) => (v ?? 0) >= 0)
    && Math.abs((cl.tanks ?? 0) + (cl.facilities ?? 0) + (cl.vertical_assets ?? 0) - capex) <= Math.max(1e-6, 1e-9 * capex);
  const cf_lines: CfLines = {
    operating: nonZero({ net_income: netIncome, depreciation, inventory_change: -deltaInventory }),
    investing: nonZero({
      ...(capOk ? { tanks: -(cl!.tanks ?? 0), facilities: -(cl!.facilities ?? 0), vertical_assets: -(cl!.vertical_assets ?? 0) } : { capex: -capex }),
      divestment: disposal,
    }),
    financing: nonZero({
      debt_draw: draw, debt_repay: -repayPaid, overdraft, equity: equityNet, dividends: -dividend,
      convertible_draw: convDraw, convertible_repaid: -convRepaid, rbf_draw: rbfDraw, rbf_repaid: -rbfPrinPaid,
    }),
    other: nonZero({ shock: -cashHit }),
  };
  const debt_lines = nonZero({ bank: debtNext, convertible: conv?.principal ?? 0, rbf: rbfPrin });

  return {
    pnl: { revenue: input.revenue, cogs: input.cogs, gross, opex, spoilage, depreciation, ebit, interest, net_income: netIncome, opex_lines },
    balance_sheet: { cash: cashNext, ppe: ppeNext, inventory: invEnd, assets, debt: debtTotal, paid_in: paidNext, retained: retainedNext, equity, debt_lines },
    cash_flow: { operating, investing, financing, delta_cash: deltaCash, cf_lines },
    cost_of_capital: { r_debt: rDebt, coverage, leverage, credit_rationed: creditRationed },
    next: {
      cash: cashNext, debt: debtNext, paid_in_capital: paidNext, retained_earnings: retainedNext, ppe_book: ppeNext,
      convertible_note: conv, rbf_outstanding: rbfOut, rbf_principal: rbfPrin,
    },
    events,
  };
}

/** DW-070 invariant: every itemized line set sums to the total it itemizes (same relative tolerance
 *  as §7.2). Returns the gaps found (empty = sound). Rounds resolved before DW-070 carry no lines and
 *  pass trivially. Used by test/dw070.test.ts and the fuzzer.
 *  DW-076: with `cashNext` (the firm's cash going INTO the next round, `firm_results[].state.cash`)
 *  the post-close bridge is checked too: closing cash + Σpost_close = opening cash. */
export function statementLineGaps(pnl: PnL, bs: BalanceSheet, cf: CashFlow, cashNext?: number): string[] {
  const gaps: string[] = [];
  const sum = (o: Record<string, number | undefined> | undefined) => Object.values(o ?? {}).reduce((a: number, v) => a + (v ?? 0), 0);
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-3, 1e-9 * Math.max(Math.abs(a), Math.abs(b)));
  if (pnl.opex_lines && !near(sum(pnl.opex_lines), pnl.opex)) gaps.push(`opex_lines ${sum(pnl.opex_lines)} ≠ opex ${pnl.opex}`);
  if (bs.debt_lines && !near(sum(bs.debt_lines), bs.debt)) gaps.push(`debt_lines ${sum(bs.debt_lines)} ≠ debt ${bs.debt}`);
  const l = cf.cf_lines;
  if (l) {
    for (const s of ["operating", "investing", "financing"] as const) if (!near(sum(l[s]), cf[s])) gaps.push(`cf_lines.${s} ${sum(l[s])} ≠ ${cf[s]}`);
    const all = sum(l.operating) + sum(l.investing) + sum(l.financing) + sum(l.other);
    if (!near(all, cf.delta_cash)) gaps.push(`cf_lines total ${all} ≠ delta_cash ${cf.delta_cash}`);
    if (cashNext !== undefined && !near(bs.cash + sum(l.post_close), cashNext)) gaps.push(`closing cash ${bs.cash} + post_close ${sum(l.post_close)} ≠ opening cash ${cashNext}`);
  }
  return gaps;
}

// ── DW-076 post-close cash ledger ────────────────────────────────────────────
// M&A (resolve step 9.5) and exit / rebuild (step 10) move cash AFTER buildStatements has struck
// the books, so the cash-flow statement's closing cash ≠ the cash the firm opens next round with,
// and nothing on the statement said why. Those steps write each move here; resolve folds the
// ledger into `cf_lines.post_close`. Display only — no total the engine computes changes.
export type PostCloseLedger = Map<FirmId, Partial<Record<PostCloseKey, number>>>;
export function ledgerAdd(ledger: PostCloseLedger | undefined, firm: FirmId, key: PostCloseKey, amount: number): void {
  if (!ledger || !amount) return;
  const row = ledger.get(firm) ?? {};
  row[key] = (row[key] ?? 0) + amount;
  ledger.set(firm, row);
}

/** Drop exact-zero entries (a missing line is $0) — keeps the per-round payload small. */
export function nonZero<K extends string>(o: Partial<Record<K, number>>): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const [k, v] of Object.entries(o) as [K, number | undefined][]) if (v) out[k] = v;
  return out;
}

/** Firm valuation for the investor path (§7.5). `skipFounding` drops the firm's first
 *  round (its planned founding loss) from the earnings window — DW-071's equity gate. */
export function firmValuation(f: FirmState, c: Pick<Config, "finance">, skipFounding = false): number {
  const netAssets = f.cash + f.ppe_book - f.debt; // = book equity
  const window = Math.max(1, c.finance.valuation.normalization_window);
  const recent = (skipFounding ? f.ni_history.slice(1) : f.ni_history).slice(-window);
  const normEarnings = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  const pw = c.finance.valuation.premium_weights;
  const premium =
    pw.Q * f.Q + pw.B * f.B + pw.T_emp * f.T_emp + pw.T_inv * f.T_inv + pw.T_gov * f.T_gov + pw.cap * f.cap + pw.process * f.process;
  return netAssets + c.finance.valuation.multiple * normEarnings + premium;
}

/** DW-071: the most equity investors will fund this round — a fraction of the firm's
 *  valuation going INTO the round, 0 once that valuation is ≤ 0. Infinity when the gate is
 *  off (or absent from a pre-DW-071 game's stored config). The student view calls this on
 *  the same beginning-of-round state the resolver does, so the form's promise is the result. */
export function equityCapacity(f: FirmState, c: Pick<Config, "finance">): number {
  const g = c.finance.equity_gate;
  if (!g?.enabled) return Infinity;
  return Math.max(0, g.max_fraction_of_valuation * firmValuation(f, c, g.skip_founding_round));
}

/** Keys used by the valuation premium (kept here to stay in sync with the type). */
export const PREMIUM_KEYS: StockKey[] = ["cap", "Q", "B", "T_emp", "T_inv", "T_gov", "process"];
