import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModelJson } from "../../lib/agent/model-json.js";

test("parses plain valid JSON", () => {
  assert.deepEqual(parseModelJson('{"a": 1, "b": [2, 3]}'), { a: 1, b: [2, 3] });
});

test("strips markdown fences", () => {
  assert.deepEqual(parseModelJson('```json\n{"a": 1}\n```'), { a: 1 });
});

test("strips leading prose before the JSON", () => {
  assert.deepEqual(parseModelJson('Here is the memo:\n{"a": 1}'), { a: 1 });
});

test("strips trailing prose after the JSON", () => {
  assert.deepEqual(parseModelJson('{"a": 1}\nLet me know if you need edits.'), {
    a: 1,
  });
});

// Regression: the 2026-07-05 growth-memo failure. The model closed one brace
// too many after the nested draft object ("}}}," instead of "}},"), ending the
// root object early and leaving the rest of the memo as trailing garbage.
test("repairs one stray extra closing brace after a nested object", () => {
  const text =
    '{"summary": "s", "move_of_the_week": {"title": "t", "draft": {"kind": "note", "body": "b"}}},' +
    ' "experiments": [{"title": "e1"}], "ops": [{"title": "o1"}]}';
  const parsed = parseModelJson(text) as Record<string, unknown>;
  assert.ok(parsed);
  assert.equal(parsed.summary, "s");
  assert.deepEqual(parsed.experiments, [{ title: "e1" }]);
  assert.deepEqual(parsed.ops, [{ title: "o1" }]);
});

test("repairs two stray extra closing braces", () => {
  const text = '{"a": {"b": 1}}}}, "c": 2}';
  assert.deepEqual(parseModelJson(text), { a: { b: 1 }, c: 2 });
});

test("repairs a stray closing bracket mid-stream", () => {
  assert.deepEqual(parseModelJson('{"a": [1, 2]], "b": 3}'), { a: [1, 2], b: 3 });
});

// max_tokens truncation: unterminated string + unclosed braces.
test("closes truncated output cut mid-string", () => {
  const parsed = parseModelJson(
    '{"summary": "s", "watching": [{"title": "cut off here'
  ) as Record<string, unknown>;
  assert.ok(parsed);
  assert.equal(parsed.summary, "s");
  assert.deepEqual(parsed.watching, [{ title: "cut off here" }]);
});

test("closes truncated output cut after a comma", () => {
  const parsed = parseModelJson('{"a": 1, "b": [{"c": 2},') as Record<string, unknown>;
  assert.ok(parsed);
  assert.equal(parsed.a, 1);
  assert.deepEqual(parsed.b, [{ c: 2 }]);
});

test("returns null for unsalvageable text", () => {
  assert.equal(parseModelJson("no json here at all"), null);
  assert.equal(parseModelJson(""), null);
  assert.equal(parseModelJson('{"a": '), null); // cut where no closer helps
});
