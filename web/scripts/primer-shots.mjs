// Video primer captures (11-16) — one frame per step of the guided first round, keyed to
// docs/onboarding/video-primer-shotlist.md. Walks the real "Learn the game" practice game: the coach card is hidden
// in the frames (the narration says what it says) and its ring is kept as the highlight. Needs the web dev server
// (solo runs in the browser; no API) and Chrome. Run:
//   WEB=http://localhost:5173 OUT=.scratch/onboarding/shots node web/scripts/primer-shots.mjs
// DARK=1 shoots the dark theme too. The frames are for the edit and Devin's read — they stay out of the repo.
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = (process.env.WEB ?? "http://localhost:5173").replace(/\/$/, "") + "/";
const OUT = resolvePath(process.env.OUT ?? join(HERE, "..", "..", ".scratch", "onboarding", "shots"));
const MODES = process.env.DARK ? [["light", "foolscap"], ["dark", "sectional"]] : [["light", "foolscap"]];
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// AutomationControlled off ⇒ navigator.webdriver is false, so the results page opens as it does for a student.
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const written = [];
const shoot = async (n, id) => {
  await page.addStyleTag({ content: "[data-dw=guide-card]{opacity:0 !important}" }).catch(() => {});
  for (const [label, mode] of MODES) {
    await page.evaluate((m) => document.documentElement.setAttribute("data-mode", m), mode);
    await sleep(500);
    const file = join(OUT, `${String(n).padStart(2, "0")}-${id}-${label}.png`);
    await page.screenshot({ path: file });
    written.push(file);
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-mode", "foolscap"));
  await page.evaluate(() => document.querySelectorAll("style").forEach((s) => { if (s.textContent?.includes("[data-dw=guide-card]{opacity:0")) s.remove(); }));
};
const click = (sel, text) => page.evaluate((s, t) => { const b = [...document.querySelectorAll(s)].find((x) => (!t || x.textContent.includes(t)) && x.getClientRects().length > 0 && !x.disabled); if (!b) return false; b.click(); return true; }, sel, text);
const step = () => page.evaluate(() => document.querySelector("[data-dw=guide-card] #guide-title")?.textContent ?? null);

try {
  await page.goto(WEB, { waitUntil: "networkidle0" });
  await shoot(1, "lobby");
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Learn the game")), { timeout: 15000 });
  if (!(await click("button", "Learn the game"))) throw new Error(`no Learn the game card in the Lobby: ${await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent.slice(0, 18)).join(" · "))}`);
  await page.waitForSelector("[data-dw=guide-card]", { timeout: 20000 });
  // shots 2–16 follow the tour (shot 17 = the Lobby again, shot 1)
  const ids = ["welcome", "hud", "boardroom", "market", "prices", "tanks", "build", "finance", "cash", "running", "brew", "results", "statements", "value", "dispatch", "done"];
  for (let i = 0; i < ids.length; i++) {
    await sleep(1100); // scroll + ring settle
    await shoot(i + 2, ids[i]);
    if (ids[i] === "brew") {
      if (!(await click("[data-dw=commit-submit] button", "Brew"))) throw new Error("no Brew button");
      await page.waitForFunction(() => /results page/i.test(document.querySelector("[data-dw=guide-card] #guide-title")?.textContent ?? ""), { timeout: 30000 });
      continue;
    }
    if (i < ids.length - 1) await click("[data-dw=guide-card] button", "Next");
  }
  console.log(`last step: ${await step()}`);
  // 15b: the value stick a round later, with "since the quarter before"
  await click("[data-dw=guide-card] button", "Finish");
  await click("button", "On to round");
  await sleep(600);
  await click("[data-dw=commit-submit] button", "Brew");
  await page.waitForSelector("[data-dw=round-resolved]", { timeout: 30000 });
  await click("[data-dw=round-resolved] button", "Full statements");
  await sleep(500);
  await click("[data-dw-rtab=value]");
  await sleep(800);
  await page.evaluate(() => document.querySelector("[data-dw=value-stick]")?.scrollIntoView({ block: "start" }));
  await shoot("15b", "value-round2");
} catch (e) {
  console.log("ABORT " + e.message);
  await page.screenshot({ path: join(OUT, "abort.png") }).catch(() => {});
}
console.log(`${written.length} frames → ${OUT}${errors.length ? `\npage errors: ${errors.slice(0, 3).join(" | ")}` : ""}`);
await browser.close();
