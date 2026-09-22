// Pull the visible reply out of an Anthropic message.
//
// Opus 5.5 cannot disable adaptive thinking, and Sonnet 5 thinks unless the
// request says otherwise. Either way the response can start with one or more
// `thinking` blocks (the thinking text itself is often empty when display is
// omitted) before the first `text` block. Reading content[0].text then throws
// or saves an empty string.

/** Join every block whose type is "text". Non-text blocks are skipped. */
export function messageText(
  content: readonly unknown[] | null | undefined,
): string {
  if (!content?.length) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const candidate = block as { type?: unknown; text?: unknown };
    if (candidate.type === "text" && typeof candidate.text === "string") {
      parts.push(candidate.text);
    }
  }
  return parts.join("\n");
}
