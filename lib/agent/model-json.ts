// Defensive parsing of a model's JSON reply. The agent reasoners (growth memo,
// chief of staff) ask for STRICT JSON, but a long reply occasionally arrives
// slightly malformed: wrapped in markdown fences, prefixed with prose, cut off
// by max_tokens, or (the 2026-07-05 growth-memo failure) carrying one stray
// extra closing brace after a deeply nested object, which makes the root
// object "end" early and leaves the rest of the reply as trailing garbage.
// This parser repairs those specific mechanical failure classes and nothing
// else — it never invents content, it only removes a stray closer, appends
// missing closers to a truncated tail, or strips non-JSON wrapping. Returns
// null when the text is unsalvageable; callers treat that as a degraded run.

const MAX_REPAIRS = 8;

function errorPosition(message: string): number | null {
  const m = /position (\d+)/.exec(message);
  return m ? Number(m[1]) : null;
}

// Find the nearest closing brace/bracket at or before `from`, so a
// "trailing content after JSON" error can be repaired by deleting the stray
// closer that ended the root object early.
function nearestCloserBefore(text: string, from: number): number {
  for (let i = Math.min(from, text.length - 1); i >= 0; i--) {
    const ch = text[i];
    if (ch === "}" || ch === "]") return i;
    if (!/\s/.test(ch)) return -1; // hit real content first — not this failure class
  }
  return -1;
}

// Close out JSON that was cut off mid-stream (max_tokens truncation): scan
// with string/escape awareness, then close the open string and any open
// braces/brackets. A tail cut at a spot no closer can fix (e.g. after a bare
// `"key":`) still fails the final parse and returns null.
function closeTruncated(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = text;
  if (inString) out += '"';
  out = out.replace(/,\s*$/, "");
  while (stack.length) out += stack.pop();
  return out;
}

export function parseModelJson(text: string): unknown {
  if (!text) return null;
  let cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  cleaned = cleaned.slice(start);

  for (let attempt = 0; attempt < MAX_REPAIRS; attempt++) {
    try {
      return JSON.parse(cleaned);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const pos = errorPosition(msg);

      // Valid JSON followed by trailing content. If the tail looks like more
      // JSON members (`,"experiments": ...`), the root object closed early
      // because of a stray extra `}`/`]` — delete the closer just before the
      // tail and re-parse. Otherwise the tail is prose; drop it.
      if (pos != null && /after JSON/i.test(msg)) {
        const tail = cleaned.slice(pos).trimStart();
        if (tail.startsWith("}") || tail.startsWith("]")) {
          // The tail's own leading closer is the stray one.
          const idx = cleaned.indexOf(tail[0], pos);
          cleaned = cleaned.slice(0, idx) + cleaned.slice(idx + 1);
        } else if (tail.startsWith(",") || tail.startsWith('"')) {
          const idx = nearestCloserBefore(cleaned, pos - 1);
          if (idx === -1) return null;
          cleaned = cleaned.slice(0, idx) + cleaned.slice(idx + 1);
        } else {
          cleaned = cleaned.slice(0, pos);
        }
        continue;
      }

      // A stray closer mid-stream ("Unexpected token }").
      if (pos != null && (cleaned[pos] === "}" || cleaned[pos] === "]")) {
        cleaned = cleaned.slice(0, pos) + cleaned.slice(pos + 1);
        continue;
      }

      // Truncated output (max_tokens): close the open string and brackets.
      if (/end of JSON input|unterminated string/i.test(msg)) {
        try {
          return JSON.parse(closeTruncated(cleaned));
        } catch {
          return null;
        }
      }

      // Prose after the JSON without a position hint: substring fallback.
      const end = cleaned.lastIndexOf("}");
      if (end > 0 && end < cleaned.length - 1) {
        cleaned = cleaned.slice(0, end + 1);
        continue;
      }
      return null;
    }
  }
  return null;
}
