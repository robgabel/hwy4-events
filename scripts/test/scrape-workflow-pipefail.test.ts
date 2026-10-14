// A pipeline reports the last command's status unless pipefail is on.
// `false | tee log` exits 0, so a failing scraper piped into tee is a green
// run (the Eugene fork's PR 27). GitHub's default shell is bash -eo pipefail,
// but this lock does not trust that default: a pipe is unguarded unless the
// script itself turned pipefail on, and `shell: sh` ignores that set.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  shellDropsPipefail,
  stepHidesPipeFailure,
  unguardedPipeSnippets,
  workflowRunScripts,
} from "../../lib/shell-pipefail.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("a bare pipe hides the left command's failure", () => {
  const hits = unguardedPipeSnippets("false | tee x");
  assert.equal(hits.length, 1);
  assert.match(hits[0], /false/);
});

test("set -o pipefail and set -euo pipefail guard a later pipe", () => {
  assert.deepEqual(unguardedPipeSnippets("set -o pipefail\nfalse | tee x"), []);
  assert.deepEqual(unguardedPipeSnippets("set -euo pipefail\nfalse | tee x"), []);
});

test("set +o pipefail reopens the hole", () => {
  const hits = unguardedPipeSnippets("set -o pipefail\nset +o pipefail\nfalse | tee x");
  assert.equal(hits.length, 1);
});

test("or-lists, quotes, and comments are not pipes", () => {
  assert.deepEqual(unguardedPipeSnippets("false || true"), []);
  assert.deepEqual(unguardedPipeSnippets("echo 'false | tee'"), []);
  assert.deepEqual(unguardedPipeSnippets('# false | tee\necho ok'), []);
});

test("|& is still a pipe", () => {
  assert.equal(unguardedPipeSnippets("false |& tee x").length, 1);
});

test("a YAML block scalar is not part of the script, and pipefail in the script counts", () => {
  const yaml = `
jobs:
  a:
    steps:
      - name: bad
        run: false | tee out
      - name: guarded
        run: |
          set -o pipefail
          false | tee out
      - name: plain
        run: |
          echo hello
      - name: dash
        shell: sh
        run: |
          set -o pipefail
          false | tee out
`;
  const runs = workflowRunScripts(yaml);
  assert.equal(runs.length, 4);
  assert.equal(runs[1].script.includes("| tee"), true);
  assert.equal(runs[1].script.trimStart().startsWith("|"), false);
  assert.equal(runs[2].script.trim(), "echo hello");
  assert.equal(stepHidesPipeFailure(runs[0]).length, 1);
  assert.deepEqual(stepHidesPipeFailure(runs[1]), []);
  assert.deepEqual(stepHidesPipeFailure(runs[2]), []);
  assert.equal(shellDropsPipefail("sh"), true);
  assert.equal(stepHidesPipeFailure(runs[3]).length, 1);
});

test("every workflow run script fails closed on an unguarded pipe", () => {
  const dir = join(root, ".github/workflows");
  const files = readdirSync(dir).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
  assert.ok(files.length > 0);
  for (const name of files) {
    const yaml = readFileSync(join(dir, name), "utf8");
    for (const step of workflowRunScripts(yaml)) {
      assert.deepEqual(
        stepHidesPipeFailure(step),
        [],
        `${name} hides a pipe failure: ${JSON.stringify(step.script)}`
      );
    }
  }
});

test("the scrape workflow alerts on any non-success job and does not open a GitHub issue", () => {
  const yaml = readFileSync(join(root, ".github/workflows/scrape.yml"), "utf8");
  assert.match(yaml, /if:\s*\$\{\{\s*always\(\)\s*&&\s*needs\.scrape\.result\s*!=\s*'success'\s*\}\}/);
  assert.match(yaml, /file-scrape-job-alert\.ts/);
  assert.doesNotMatch(yaml, /Create failure issue/);
  assert.doesNotMatch(yaml, /issues\.create/);
  assert.doesNotMatch(yaml, /issues:\s*write/);
});

test("scrape npm scripts have no unguarded pipe", () => {
  const pkg = JSON.parse(readFileSync(join(root, "scripts/package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const scripts = Object.entries(pkg.scripts ?? {}).filter(([name]) => name.startsWith("scrape"));
  assert.ok(scripts.length > 0);
  for (const [name, command] of scripts) {
    assert.deepEqual(unguardedPipeSnippets(command), [], name);
  }
});
