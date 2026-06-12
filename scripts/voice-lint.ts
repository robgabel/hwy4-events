/**
 * Voice lint CLI + CI gate. Runs the content/VOICE.md lint-able rules
 * (lib/voice-lint.ts) across the static site content: every town page, the FAQ,
 * and the About page.
 *
 *   cd scripts && npx tsx voice-lint.ts          # report; exit 1 on a hard-fail
 *   cd scripts && npx tsx voice-lint.ts --warn   # also print warnings
 *
 * Hard-fail (exit 1): BANNED_PHRASE, HUMANITY_CLAIM, LEAK.
 * Warn (reported, never blocks): contrast/spackle/yes-yes/exclaim/em-dash overuse,
 * and DUP_PHRASE_SITEWIDE.
 *
 * Town content is read as data text (not imported) so this stays decoupled from
 * the Next app's `@/`-aliased / JSX type chain. The FAQ is a plain data module.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  lintAll,
  HARD_FAIL_RULES,
  type PageSource,
  type Violation,
} from "../lib/voice-lint.js";
import { faqs } from "../lib/faqs.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

// About is a full JSX page with no clean data export — scan its raw source for
// the safe error rules (+ em-dash). These don't false-match on code/classNames.
const ABOUT_RULES = new Set(["BANNED_PHRASE", "HUMANITY_CLAIM", "LEAK", "EMDASH"]);

/** Pull double-quoted string VALUES (the prose) out of a TS data section. */
function quotedStrings(src: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const s = m[1]
      .replace(/\\"/g, '"')
      .replace(/\\n/g, " ")
      .replace(/\\\\/g, "\\");
    if (s.length >= 4) out.push(s);
  }
  return out;
}

/**
 * One source per town, built from its prose strings. We read town-content.ts as
 * text and segment on the top-level `<slug>: {` keys (2-space indent), so the
 * file header comment (which lists banned phrases as examples) is excluded.
 */
function townSources(): PageSource[] {
  const text = readFileSync(join(REPO, "app", "towns", "town-content.ts"), "utf8");
  const sections = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of text.split("\n")) {
    const key = line.match(/^ {2}"?([a-z][a-z0-9-]*)"?:\s*\{/);
    if (key) {
      current = key[1];
      sections.set(current, []);
      continue;
    }
    if (current) sections.get(current)!.push(line);
  }
  return [...sections.entries()].map(([slug, body]) => ({
    page: `town:${slug}`,
    text: quotedStrings(body.join("\n")).join("\n"),
    dup: true,
  }));
}

export function collectSources(): PageSource[] {
  return [
    ...townSources(),
    { page: "faq", text: faqs.flatMap((f) => [f.question, f.answer]).join("\n") },
    {
      page: "about",
      text: readFileSync(join(REPO, "app", "about", "page.tsx"), "utf8"),
      rules: ABOUT_RULES,
    },
  ];
}

function report(violations: Violation[], showWarn: boolean): number {
  const errors = violations.filter((v) => HARD_FAIL_RULES.has(v.rule));
  const warns = violations.filter((v) => !HARD_FAIL_RULES.has(v.rule));

  if (errors.length) {
    console.log(`\n✗ ${errors.length} hard-fail violation(s):`);
    for (const v of errors) console.log(`  [${v.rule}] ${v.page}: ${v.excerpt}`);
  }
  if (showWarn && warns.length) {
    console.log(`\n⚠ ${warns.length} warning(s):`);
    for (const v of warns) console.log(`  [${v.rule}] ${v.page}: ${v.excerpt}`);
  }
  console.log(
    `\nvoice-lint: ${errors.length} error(s), ${warns.length} warning(s) across ${
      new Set(violations.map((v) => v.page)).size
    } flagged page(s).`,
  );
  return errors.length > 0 ? 1 : 0;
}

// Run as a CLI (not when imported by the test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const code = report(lintAll(collectSources()), process.argv.includes("--warn"));
  if (code === 0) console.log("✓ no hard-fail voice violations");
  process.exit(code);
}
