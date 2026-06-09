// The voice lint: mechanical enforcement of the lint-able rules in
// content/VOICE.md. Pure (text in, violations out) so scripts/voice-lint.ts (CLI
// + CI) and scripts/test/voice-lint.test.ts share one definition.
//
// Severity:
//   error  -> hard-fail CI (BANNED_PHRASE, HUMANITY_CLAIM, LEAK)
//   warn   -> reported, non-blocking (everything else, incl. DUP_PHRASE_SITEWIDE)

export type Severity = "error" | "warn";

export interface Violation {
  rule: string;
  severity: Severity;
  page: string;
  excerpt: string;
}

export const HARD_FAIL_RULES: ReadonlySet<string> = new Set([
  "BANNED_PHRASE",
  "HUMANITY_CLAIM",
  "LEAK",
]);

// VOICE.md rules 1-2. Word-boundaried where a substring would false-match
// (e.g. "elevate" must not catch "elevation", a real Sierra geography word).
const BANNED: { re: RegExp; label: string }[] = [
  { re: /punch(es|ing)?\s+(way\s+)?above/i, label: "punches above its weight" },
  { re: /hidden gem/i, label: "hidden gem" },
  { re: /\bnestled\b/i, label: "nestled" },
  { re: /\bvibrant\b/i, label: "vibrant" },
  { re: /\bcharming\b/i, label: "charming" },
  { re: /\bnumerous\b/i, label: "numerous" },
  { re: /a must[-\s]see/i, label: "a must-see" },
  { re: /\bboasts\b/i, label: "boasts" },
  { re: /look no further/i, label: "look no further" },
  { re: /\belevate(s|d)?\b/i, label: "elevate" },
  { re: /\bunforgettable\b/i, label: "unforgettable" },
  { re: /whether you(’re|'re| are)\b/i, label: "whether you're X or Y" },
  { re: /most complete/i, label: "most complete (self-superlative)" },
  { re: /most up[-\s]to[-\s]date/i, label: "most up-to-date (self-superlative)" },
];

const HUMANITY_RE =
  /not a robot|not a machine|real human|written by (a )?(neighbor|person|human)|isn't (a )?(robot|machine)/i;

const LEAK_RE = /\(Rob:|\bTODO\b|\bFIXME\b|\[draft|<!--/;

function count(text: string, re: RegExp): number {
  return (text.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) || [])
    .length;
}

function snippet(text: string, re: RegExp): string {
  const m = text.match(re);
  if (!m || m.index == null) return "";
  const i = Math.max(0, m.index - 30);
  return text.slice(i, m.index + m[0].length + 30).replace(/\s+/g, " ").trim();
}

/**
 * Lint one logical page's prose. `rules` limits which checks run (default all) —
 * raw-source pages like the About JSX pass only the safe error rules.
 */
export function lintPage(
  page: string,
  text: string,
  rules?: ReadonlySet<string>,
): Violation[] {
  const out: Violation[] = [];
  const on = (r: string) => !rules || rules.has(r);

  if (on("BANNED_PHRASE")) {
    for (const { re, label } of BANNED) {
      if (re.test(text)) {
        out.push({ rule: "BANNED_PHRASE", severity: "error", page, excerpt: `"${label}" — ${snippet(text, re)}` });
      }
    }
  }
  if (on("HUMANITY_CLAIM") && HUMANITY_RE.test(text)) {
    out.push({ rule: "HUMANITY_CLAIM", severity: "error", page, excerpt: snippet(text, HUMANITY_RE) });
  }
  if (on("LEAK") && LEAK_RE.test(text)) {
    out.push({ rule: "LEAK", severity: "error", page, excerpt: snippet(text, LEAK_RE) });
  }

  if (on("CONTRAST_OVERUSE")) {
    const n = count(text, /,\s+not\s+\w/i) + count(text, /[—–-]\s*not\s+(just\s+)?\w/i);
    if (n > 1) out.push({ rule: "CONTRAST_OVERUSE", severity: "warn", page, excerpt: `${n} "X, not Y" constructions (max 1)` });
  }
  if (on("SPACKLE_OVERUSE")) {
    const n = count(text, /\b(actually|genuinely|truly)\b/i);
    if (n > 2) out.push({ rule: "SPACKLE_OVERUSE", severity: "warn", page, excerpt: `${n} sincerity-spackle words (max 2)` });
  }
  if (on("YES_YES")) {
    const n = count(text, /\band yes\b/i) + count(text, /yes,[^.!?]*yes,/i);
    if (n > 1) out.push({ rule: "YES_YES", severity: "warn", page, excerpt: `${n} "And yes / Yes... Yes" moves (max 1)` });
  }
  if (on("EXCLAIM")) {
    const n = count(text, /!/);
    if (n > 0) out.push({ rule: "EXCLAIM", severity: "warn", page, excerpt: `${n} exclamation point(s) in our copy` });
  }
  if (on("EMDASH")) {
    const n = count(text, /—/);
    if (n > 0) out.push({ rule: "EMDASH", severity: "warn", page, excerpt: `${n} em-dash(es)` });
  }

  return out;
}

const STOP_GRAM = /^(the|a|an|and|or|of|to|in|on|for|with|at|is|it|its|that|this)$/;

/**
 * DUP_PHRASE_SITEWIDE: any 4-word n-gram appearing on >=3 pages. Catches the next
 * "punches above its weight" before a reader does. Skips grams that are entirely
 * stopwords (template-ish filler).
 */
export function lintDuplicatePhrases(pages: { page: string; text: string }[]): Violation[] {
  const gramPages = new Map<string, Set<string>>();
  for (const { page, text } of pages) {
    const tokens = (text.toLowerCase().match(/[a-z0-9']+/g) || []);
    for (let i = 0; i + 4 <= tokens.length; i++) {
      const gram = tokens.slice(i, i + 4);
      if (gram.every((t) => STOP_GRAM.test(t))) continue;
      const key = gram.join(" ");
      if (!gramPages.has(key)) gramPages.set(key, new Set());
      gramPages.get(key)!.add(page);
    }
  }
  const out: Violation[] = [];
  for (const [gram, pgs] of gramPages) {
    if (pgs.size >= 3) {
      out.push({
        rule: "DUP_PHRASE_SITEWIDE",
        severity: "warn",
        page: [...pgs].sort().join(", "),
        excerpt: `"${gram}" on ${pgs.size} pages`,
      });
    }
  }
  return out;
}

export interface PageSource {
  page: string;
  text: string;
  /** Limit to these rule ids (e.g. raw JSX pages run error-only). */
  rules?: ReadonlySet<string>;
  /** Include in the cross-page duplicate-phrase scan. */
  dup?: boolean;
}

export function lintAll(sources: PageSource[]): Violation[] {
  const out: Violation[] = [];
  for (const s of sources) out.push(...lintPage(s.page, s.text, s.rules));
  out.push(...lintDuplicatePhrases(sources.filter((s) => s.dup)));
  return out;
}
