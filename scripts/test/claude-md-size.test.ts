// HWY-66 / GitHub #329. CLAUDE.md is the session map. The long reference
// lives in docs/subsystems/ and is loaded on demand. This test keeps the map
// from growing back, and fails when a relative link in the map or a
// subsystem doc does not resolve.
//
// Token estimate matches the issue: bytes / 4. 263,657 bytes was ~66K tokens.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLAUDE = join(ROOT, "CLAUDE.md");
const SUBSYSTEMS = join(ROOT, "docs", "subsystems");

// Issue #329: fail above 60 KB. The same cut is under 15K tokens at bytes/4
// (15_000 * 4 = 60_000), which is the stricter of the two caps.
const MAX_BYTES = 60 * 1024;
const MAX_TOKENS = 15_000;

function stripCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

function markdownLinks(markdown: string): string[] {
  const links: string[] = [];
  const re = /\[[^\]]*\]\(([^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  const source = stripCode(markdown);
  while ((match = re.exec(source))) links.push(match[1]);
  return links;
}

function isSkippable(dest: string): boolean {
  if (/^(https?:|mailto:)/i.test(dest)) return true;
  // Absolute path outside the repo (content/VOICE points at SOUL.md on Rob's machine).
  if (dest.startsWith("/")) return true;
  // Illustrative links in the moved prose, not files: `[label](url)` is inside
  // code and already stripped; the Kane Brown example uses an ellipsis.
  const path = dest.split("#")[0];
  if (!path || path === "url" || path.includes("…")) return true;
  return false;
}

test("CLAUDE.md stays under 60 KB and under 15K tokens", () => {
  const bytes = Buffer.byteLength(readFileSync(CLAUDE));
  const tokens = Math.round(bytes / 4);
  assert.ok(
    bytes <= MAX_BYTES && tokens < MAX_TOKENS,
    `CLAUDE.md is ${bytes} bytes (~${tokens} tokens). Limit is ${MAX_BYTES} bytes and ${MAX_TOKENS} tokens. Move detail into docs/subsystems/.`,
  );
});

test("every relative link in CLAUDE.md and docs/subsystems resolves", () => {
  const files = [
    CLAUDE,
    ...readdirSync(SUBSYSTEMS)
      .filter((name) => name.endsWith(".md"))
      .map((name) => join(SUBSYSTEMS, name)),
  ];
  const missing: string[] = [];
  for (const file of files) {
    for (const dest of markdownLinks(readFileSync(file, "utf8"))) {
      if (isSkippable(dest)) continue;
      const path = dest.split("#")[0];
      const target = resolve(dirname(file), path);
      const label = `${relative(ROOT, file)} -> ${dest}`;
      if (!target.startsWith(ROOT + "/") && target !== ROOT) {
        missing.push(`${label} (escapes the repo)`);
        continue;
      }
      if (!existsSync(target)) missing.push(label);
    }
  }
  assert.deepEqual(missing, []);
});

test("the map links every subsystem doc in one hop", () => {
  const claude = readFileSync(CLAUDE, "utf8");
  const names = readdirSync(SUBSYSTEMS).filter((name) => name.endsWith(".md"));
  const unlinked = names.filter((name) => !claude.includes(`docs/subsystems/${name}`));
  assert.deepEqual(unlinked, []);
});

test("standing rules stay in the map", () => {
  const claude = readFileSync(CLAUDE, "utf8");
  for (const marker of [
    "Rob's OK",
    "generateDedupKey",
    "GoCalaveras",
    "agent_actions",
    "status='cancelled'",
    "pr-qa/SKILL.md",
    "Never-guess",
    "is_routine",
    "series_umbrella",
  ]) {
    assert.ok(claude.includes(marker), `CLAUDE.md dropped standing rule marker "${marker}"`);
  }
});
