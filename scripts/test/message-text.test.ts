import { test } from "node:test";
import assert from "node:assert/strict";
import { messageText } from "../../lib/agent/message-text.js";
import {
  DEFAULT_MODEL,
  EXTRACT_MODEL,
  HAIKU_MODEL,
  PREMIUM_COPY_MODEL,
  REASONER_MODEL,
} from "../../lib/agent/models.js";

test("joins text that follows a thinking block", () => {
  const text = messageText([
    { type: "thinking", thinking: "weigh the venues" },
    { type: "text", text: "Friday at Ironstone." },
  ]);
  assert.equal(text, "Friday at Ironstone.");
});

test("joins every text block and skips tool blocks between them", () => {
  const text = messageText([
    { type: "text", text: "line one" },
    { type: "server_tool_use", id: "toolu_1" },
    { type: "text", text: "line two" },
  ]);
  assert.equal(text, "line one\nline two");
});

test("returns empty for no content, thinking-only, and a text block with no string", () => {
  assert.equal(messageText([]), "");
  assert.equal(messageText(null), "");
  assert.equal(messageText(undefined), "");
  assert.equal(messageText([{ type: "thinking", thinking: "" }]), "");
  assert.equal(messageText([{ type: "text" }]), "");
  assert.equal(messageText([{ type: "text", text: 12 }]), "");
});

test("model ids stay on the bumped set, and Haiku is unchanged", () => {
  assert.equal(PREMIUM_COPY_MODEL, "claude-opus-5-5");
  assert.equal(REASONER_MODEL, "claude-sonnet-5");
  assert.equal(DEFAULT_MODEL, REASONER_MODEL);
  assert.equal(HAIKU_MODEL, "claude-haiku-4-5-20251001");
  assert.equal(EXTRACT_MODEL, HAIKU_MODEL);
});
