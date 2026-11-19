import type { Config } from "../../src/types.js";

/** The model as Sprint 1–2 ran it: every DW-083/DW-084 (v3) switch removed, which is how a stored
 *  pre-v3 game config reads them (absent ⇒ legacy). For tests pinned to pre-v3 numbers or to a
 *  legacy rule; mutates and returns the (freshly resolved) config. */
export function preDw083(c: Config): Config {
  pre1118(c);
  delete c.demand.stock_knee;
  delete c.demand.phantom_competitors;
  delete c.finance.affordability_guard;
  delete c.finance.overdraft;
  delete c.finance.repay_cash_cap;
  delete c.finance.cash_flow_lending; // v3 audit
  return c;
}

/** A game stored before 11-18: no staff-need rule (costs.wts), the book-basis equity gate, first-choice Market share. */
export function pre1118(c: Config): Config {
  delete c.costs.wts;
  if (c.finance.equity_gate) delete c.finance.equity_gate.basis;
  delete c.scoring.market_basis;
  return c;
}
