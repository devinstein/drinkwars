// Guided-round audit (11-16, Devin's review: the tour card and its ring crossed an officer's popover). Walks
// Lobby → "Learn the game" → every tour step at a desktop, a laptop and a phone viewport, and checks that the coach
// card stays on screen, never covers the panel it explains (unless that panel fills the screen), never overlaps an
// open popover, never covers Brew on the Brew step, and that the ring is hidden while a popover is open. On a phone the
// panel's top must sit below the top-docked card. Needs only the web dev server (solo runs in the browser). Run:
//   WEB=http://localhost:5173 node web/scripts/tour-audit.mjs
import puppeteer from "puppeteer-core";
const WEB = (process.env.WEB ?? "http://localhost:5173").replace(/\/$/, "") + "/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const ok = (c, l, d = "") => { const line = `${c ? "PASS" : "FAIL"}  ${l}${d ? " — " + d : ""}`; results.push(line); console.log(line); };
// AutomationControlled off ⇒ navigator.webdriver is false, so the results page opens as it does for a student
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
const VPS = [{ name: "desktop", w: 1440, h: 900 }, { name: "laptop", w: 1100, h: 760 }, { name: "phone", w: 390, h: 844, mobile: true }];

/** Geometry of the card, the step's panel, open popovers, the ring and Brew, read in the page. */
const probe = (page) => page.evaluate(() => {
  const vis = (sel) => [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length > 0) ?? null;
  const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const card = document.querySelector("[data-dw=guide-card]");
  const title = card?.querySelector("#guide-title")?.textContent ?? "";
  const ring = [...document.querySelectorAll("div[aria-hidden]")].find((d) => d.className.includes("z-[35]")) ?? null;
  const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter((d) => d.getClientRects().length > 0 && d.dataset.dw !== "round-resolved").map(box);
  const brew = [...document.querySelectorAll("[data-dw=commit-submit] button, [data-dw=commit-sheet] button")].find((b) => /Brew/.test(b.textContent) && b.getClientRects().length > 0);
  return { title, card: box(card), ring: box(ring), dialogs, brew: box(brew), vw: innerWidth, vh: innerHeight };
});
const overlap = (a, b) => !!a && !!b && !(a.r <= b.l + 1 || a.l >= b.r - 1 || a.b <= b.t + 1 || a.t >= b.b - 1);
const TARGET = { hud: "[data-dw=hud]", boardroom: "[data-dw=boardroom]", market: "[data-dw-brief=cmo]", prices: "[data-dw=prices-card]", tanks: "[data-dw=tanks-card]", build: "[data-dw=build-card]", finance: "[data-dw=financing-card]", cash: "[data-testid=cash-and-credit]", running: "[data-testid=running-costs]", brew: "[data-dw=commit-submit]" };
const STEPS = ["welcome", "hud", "boardroom", "market", "prices", "tanks", "build", "finance", "cash", "running", "brew", "results", "statements", "value", "dispatch", "done"];

try {
  for (const vp of VPS) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
    const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(WEB, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Learn the game")), { timeout: 15000 });
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Learn the game")).click());
    await page.waitForSelector("[data-dw=guide-card]", { timeout: 20000 });
    const bad = [];
    for (let i = 0; i < STEPS.length; i++) {
      const id = STEPS[i];
      await sleep(1300); // scroll + measure settle
      const g = await probe(page);
      const sel = TARGET[id];
      const target = sel ? await page.evaluate((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.getClientRects().length > 0); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel) : null;
      const c = g.card;
      if (!c || c.l < 0 || c.t < 0 || c.r > g.vw + 0.5 || c.b > g.vh + 0.5) bad.push(`${id}: card off screen ${JSON.stringify(c)}`);
      // the card covers the panel only when the panel leaves no room (taller than the screen minus the card)
      const roomy = target && (vp.mobile ? target.h < g.vh - c.h - 40 : target.w < g.vw * 0.6);
      if (target && roomy && overlap(c, target)) bad.push(`${id}: card covers the panel`);
      if (vp.mobile && target && roomy && c.t < g.vh / 2 && target.t < c.b - 4) bad.push(`${id}: panel top ${Math.round(target.t)} hidden under the card (bottom ${Math.round(c.b)})`);
      if (id === "brew" && overlap(c, g.brew)) bad.push("brew: card covers Brew");
      // Devin's case: an officer's popover opened mid-tour
      if (id === "boardroom") {
        await page.evaluate(() => [...document.querySelectorAll("[data-dw-brief=cmo] button")].find((b) => b.getClientRects().length > 0)?.click());
        await sleep(700);
        const p = await probe(page);
        if (!p.dialogs.length) bad.push("boardroom: the CMO popover did not open");
        if (p.dialogs.some((d) => overlap(p.card, d))) bad.push("boardroom: card overlaps the CMO popover");
        if (p.ring) bad.push("boardroom: ring still drawn over an open popover");
        // close it with its own ✕ (Escape would also close the tour, by design)
        await page.evaluate(() => [...document.querySelectorAll('[role="dialog"][aria-modal="true"] button[aria-label="Close"]')].filter((b) => b.getClientRects().length > 0).forEach((b) => b.click()));
        await sleep(500);
        await page.evaluate(() => document.querySelector("[data-dw=guide-card]")?.focus());
      }
      if (id === "brew") {
        await page.evaluate(() => [...document.querySelectorAll("[data-dw=commit-submit] button, [data-dw=commit-sheet] button")].find((b) => /Brew/.test(b.textContent) && b.getClientRects().length > 0)?.click());
        await page.waitForFunction(() => /results page/i.test(document.querySelector("[data-dw=guide-card] #guide-title")?.textContent ?? ""), { timeout: 30000 });
        continue;
      }
      if (i < STEPS.length - 1) await page.evaluate(() => [...document.querySelectorAll("[data-dw=guide-card] button")].find((b) => b.textContent.trim() === "Next")?.click());
    }
    ok(bad.length === 0, `${vp.name} ${vp.w}×${vp.h}: all ${STEPS.length} steps — card on screen, clear of its panel, popovers and Brew`, bad.join(" | "));
    ok(errs.length === 0, `${vp.name}: no page errors`, errs.slice(0, 2).join(" | "));
    await ctx.close();
  }
} catch (e) { results.push("ABORT " + e.message); console.log("ABORT " + e.message); }
await browser.close();
const fails = results.filter((l) => !l.startsWith("PASS"));
console.log(`DONE ${results.length - fails.length} pass, ${fails.length} fail`);
process.exit(fails.length ? 1 : 0);
