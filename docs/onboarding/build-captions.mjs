// Video primer: captions (.vtt) and transcript (.txt) from the script, so an edit to the script is one command away
// from matching captions. Timings are estimates (150 words a minute, a short pause between sections); re-time the
// .vtt against the recording before publishing (WCAG 1.2.2 needs captions that match the audio).
//   node docs/onboarding/build-captions.mjs          → writes video-primer.vtt + video-primer-transcript.txt, prints section timings
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const WPS = 150 / 60; // words per second
const PAUSE = 2; // seconds between sections
const MAX = 84; // characters per cue (two lines of ~42)

const md = readFileSync(join(DIR, "video-primer-script.md"), "utf8");
const body = md.split(/\n---\n/)[1] ?? md;
const sections = body.split(/\n## /).slice(1).map((s) => {
  const [head, ...rest] = s.split("\n");
  return { title: head.replace(/\s*\(.*$/, "").trim(), text: rest.filter((l) => l.trim() && !l.startsWith("#")).join(" ").trim() };
});

const ts = (t) => { const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`; };
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;
/** Split a sentence into cues of at most MAX characters, at word boundaries. */
const chunks = (sentence) => {
  const out = []; let cur = "";
  for (const w of sentence.split(/\s+/)) { if ((cur + " " + w).trim().length > MAX && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
  if (cur) out.push(cur);
  return out;
};

/** Break a cue over two lines near its middle (caption lines of ~42 characters read best). */
const twoLines = (c) => {
  if (c.length <= 42) return c;
  const mid = c.length / 2; let best = -1;
  for (let i = 0; i < c.length; i++) if (c[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? c : `${c.slice(0, best)}\n${c.slice(best + 1)}`;
};

let t = 0, n = 0;
const cues = [], table = [];
for (const sec of sections) {
  const start = t;
  for (const sentence of sec.text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [sec.text]) {
    for (const c of chunks(sentence.trim())) {
      const dur = Math.max(1.2, c.split(/\s+/).length / WPS);
      cues.push(`${++n}\n${ts(t)} --> ${ts(t + dur)}\n${twoLines(c)}`);
      t += dur;
    }
  }
  table.push(`${mmss(start)}–${mmss(t)}  ${sec.title}`);
  t += PAUSE;
}
writeFileSync(join(DIR, "video-primer.vtt"), `WEBVTT\n\nNOTE Draft timings from the script (150 words a minute). Re-time against the recording.\n\n${cues.join("\n\n")}\n`);
writeFileSync(join(DIR, "video-primer-transcript.txt"), `Drink Wars: one round, desk by desk (video transcript)\n\n${sections.map((s) => `${s.title}\n\n${s.text}`).join("\n\n")}\n`);
console.log(`${cues.length} cues, ${mmss(t - PAUSE)} total\n${table.join("\n")}`);
