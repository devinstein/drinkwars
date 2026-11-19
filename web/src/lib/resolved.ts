import type { GameView } from "../game/controller.js";

/** 11-16: has any round resolved yet? Class views carry `result: null` (only solo has the full result), so use what both send. */
export const hasResolved = (v: Pick<GameView, "ownResult" | "result" | "history">): boolean => !!(v.result || v.ownResult || (v.history?.length ?? 0) > 0);
