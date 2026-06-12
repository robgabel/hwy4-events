// Pins lib/voice.ts (VOICE_MD, injected into every prompt) to content/VOICE.md
// (the human source of truth). If they drift, CI fails with the first differing
// line. Edit content/VOICE.md, then mirror it into lib/voice.ts.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { VOICE_MD } from "../../lib/voice.js";

const here = dirname(fileURLToPath(import.meta.url));
const VOICE_PATH = join(here, "..", "..", "content", "VOICE.md");

test("VOICE_MD is byte-identical to content/VOICE.md", () => {
  const onDisk = readFileSync(VOICE_PATH, "utf8").trim();
  const inCode = VOICE_MD.trim();

  if (onDisk !== inCode) {
    const a = onDisk.split("\n");
    const b = inCode.split("\n");
    let firstDiff = -1;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        firstDiff = i;
        break;
      }
    }
    assert.fail(
      `content/VOICE.md and lib/voice.ts VOICE_MD have drifted at line ${firstDiff + 1}:\n` +
        `  content/VOICE.md: ${JSON.stringify(a[firstDiff])}\n` +
        `  lib/voice.ts:     ${JSON.stringify(b[firstDiff])}\n` +
        `Edit content/VOICE.md, then mirror it into lib/voice.ts.`,
    );
  }
  assert.equal(inCode, onDisk);
});

test("VOICE_MD carries the load-bearing rules (guards against an empty paste)", () => {
  for (const marker of [
    "punches above its weight",
    "Miss Debbie pattern",
    "not a robot",
    "Em-dashes: avoid",
    "we DO have /submit",
  ]) {
    assert.ok(VOICE_MD.includes(marker), `VOICE_MD missing "${marker}"`);
  }
});
