// A pipeline reports the last command's status unless pipefail is on.
// `false | tee log` exits 0, so a failing scrape piped into tee is a green run.
// GitHub's default `run:` shell is `bash -eo pipefail`, which would catch it,
// but a script run under `sh`, a custom `shell:` template, or outside Actions
// does not inherit that. This scanner does not trust the runner default: a
// pipe is unguarded unless the script itself turned pipefail on and left it on.

export type WorkflowRun = {
  script: string;
  /** The step's `shell:` value, or null when the step uses the runner default. */
  shell: string | null;
};

/** Shell pipes whose failure is hidden. Each entry is the command left of the pipe. */
export function unguardedPipeSnippets(script: string): string[] {
  const hits: string[] = [];
  let pipefail = false;
  let i = 0;
  let commandStart = 0;
  let atCommandStart = true;
  const s = script;

  while (i < s.length) {
    const c = s[i];
    if (c === "\n") {
      atCommandStart = true;
      i++;
      commandStart = i;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    if (c === "#") {
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    if (c === "'" || c === '"') {
      atCommandStart = false;
      const q = c;
      i++;
      while (i < s.length && s[i] !== q) {
        if (q === '"' && s[i] === "\\") i += 2;
        else i++;
      }
      if (i < s.length) i++;
      continue;
    }
    if (c === ";") {
      atCommandStart = true;
      i++;
      commandStart = i;
      continue;
    }
    if (c === "&" && s[i + 1] === "&") {
      atCommandStart = true;
      i += 2;
      commandStart = i;
      continue;
    }
    if (c === "|" && s[i + 1] === "|") {
      atCommandStart = true;
      i += 2;
      commandStart = i;
      continue;
    }
    if (c === "|") {
      if (!pipefail) {
        const left = s.slice(commandStart, i).replace(/\s+/g, " ").trim().slice(0, 80);
        hits.push(left || "|");
      }
      i++;
      if (s[i] === "&") i++;
      atCommandStart = true;
      commandStart = i;
      continue;
    }
    if (atCommandStart && s.startsWith("set", i) && !/[A-Za-z0-9_]/.test(s[i + 3] ?? "")) {
      const from = i;
      i += 3;
      while (i < s.length && s[i] !== "\n" && s[i] !== ";" && s[i] !== "|" && s[i] !== "&") i++;
      pipefail = applySetPipefail(s.slice(from, i), pipefail);
      atCommandStart = false;
      continue;
    }
    atCommandStart = false;
    i++;
  }
  return hits;
}

function applySetPipefail(command: string, current: boolean): boolean {
  const args = command.trim().split(/\s+/).slice(1);
  let on = current;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = args[i + 1];
    if ((a === "-o" || a === "+o") && next === "pipefail") {
      on = a === "-o";
      i++;
      continue;
    }
    // `set -euo pipefail` is `set -e -u -o pipefail`: the o flag consumes the next word.
    if (/^-[A-Za-z]*o[A-Za-z]*$/.test(a) && next === "pipefail") {
      on = true;
      i++;
    }
  }
  return on;
}

/** `sh` / dash has no pipefail. A custom `shell: ... {0}` drops the runner flags unless it says pipefail. */
export function shellDropsPipefail(shell: string | null): boolean {
  if (!shell) return false;
  const value = shell.trim();
  if (value === "sh" || value.startsWith("sh ")) return true;
  if (value.includes("{0}") && !value.includes("pipefail")) return true;
  return false;
}

export function stepHidesPipeFailure(step: WorkflowRun): string[] {
  // dash does not implement pipefail, and a custom shell template drops the
  // runner's -o pipefail, so a `set -o pipefail` in the script is not enough.
  if (shellDropsPipefail(step.shell)) {
    return unguardedPipeSnippets(step.script.replace(/pipefail/g, "pipefail_off"));
  }
  return unguardedPipeSnippets(step.script);
}

/**
 * Every `run:` body in a workflow file, paired with that step's `shell:`
 * when the step sets one. The YAML `|` block indicator is not part of the
 * script. Good enough for this repo's workflow style (no nested `run:`).
 */
export function workflowRunScripts(yaml: string): WorkflowRun[] {
  const lines = yaml.split("\n");
  const runs: WorkflowRun[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^(\s*)run:\s*(.*)$/.exec(lines[i]);
    if (!match) continue;
    const indent = match[1].length;
    const rest = match[2].trim();
    let script: string;
    let next = i + 1;
    if (rest === "|" || rest === "|-" || rest === "|+" || rest === ">" || rest === ">-" || rest === ">+") {
      const body: string[] = [];
      while (next < lines.length) {
        const line = lines[next];
        if (line.trim() === "") {
          body.push("");
          next++;
          continue;
        }
        const lead = /^ */.exec(line)?.[0].length ?? 0;
        if (lead <= indent) break;
        body.push(line);
        next++;
      }
      script = dedent(body);
    } else {
      script = unquote(rest);
    }
    const shell = shellForStep(lines, i, indent);
    runs.push({ script, shell });
    i = next - 1;
  }
  return runs;
}

function unquote(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function dedent(body: string[]): string {
  const indents = body
    .filter((l) => l.trim() !== "")
    .map((l) => /^ */.exec(l)?.[0].length ?? 0);
  const min = indents.length ? Math.min(...indents) : 0;
  return body
    .map((l) => (l.trim() === "" ? "" : l.slice(min)))
    .join("\n")
    .replace(/\s+$/, "");
}

/** Look at keys of the same step (the list item that contains this `run:`). */
function shellForStep(lines: string[], runLine: number, runIndent: number): string | null {
  let start = runLine;
  while (start > 0) {
    const lead = /^ */.exec(lines[start])?.[0].length ?? 0;
    if (lines[start].trim().startsWith("- ") && lead < runIndent) break;
    if (lead < runIndent && lines[start].trim() !== "") break;
    start--;
  }
  let end = runLine + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === "") {
      end++;
      continue;
    }
    const lead = /^ */.exec(line)?.[0].length ?? 0;
    if (lead < runIndent) break;
    if (lead === runIndent && line.trim().startsWith("- ")) break;
    end++;
  }
  for (let i = start; i < end; i++) {
    const m = /^\s*shell:\s*(.+?)\s*$/.exec(lines[i]);
    if (m) return unquote(m[1]);
  }
  return null;
}
