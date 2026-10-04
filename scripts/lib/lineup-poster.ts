// Vision read of one lineup poster or single-night flyer (HWY-59).
//
// The pure rules (what counts as an act, open mic, the public title) live in
// lib/lineup-acts.ts. This file only fetches the image and asks the model to
// transcribe it. A failed fetch or a non-JSON reply is an empty reading, so
// the scrape keeps the calendar title instead of inventing a band.

import Anthropic from "@anthropic-ai/sdk";
import { REASONER_MODEL, THINKING_DISABLED } from "../../lib/agent/models.js";
import { messageText } from "../../lib/agent/message-text.js";
import {
  lineupPosterPrompt,
  parseLineupReading,
  type LineupNight,
} from "../../lib/lineup-acts.js";

const MAX_IMAGE_BYTES = 4_000_000;

const MEDIA_BY_EXT: Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp"> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

function imageMediaType(
  contentType: string | null,
  url: string
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null {
  const ct = contentType?.split(";")[0]?.trim().toLowerCase();
  if (ct === "image/jpg" || ct === "image/jpeg") return "image/jpeg";
  if (ct === "image/png" || ct === "image/gif" || ct === "image/webp") return ct;
  const ext = url.split("?")[0]?.split(".").pop()?.toLowerCase() ?? "";
  return MEDIA_BY_EXT[ext] ?? null;
}

function parseModelJson(text: string): unknown {
  const jsonStr = text
    .trim()
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "");
  return JSON.parse(jsonStr);
}

/**
 * Transcribe one poster. Returns [] when the image cannot be read or the
 * model does not return a JSON array. Never throws.
 */
export async function readLineupPoster(
  client: Anthropic,
  imageUrl: string,
  years: number[]
): Promise<LineupNight[]> {
  if (!/^https:\/\//i.test(imageUrl)) return [];
  let bytes: Buffer;
  let media: ReturnType<typeof imageMediaType>;
  try {
    const resp = await fetch(imageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
    if (!resp.ok) {
      console.warn(`  LINEUP_POSTER ${imageUrl} fetch ${resp.status}`);
      return [];
    }
    media = imageMediaType(resp.headers.get("content-type"), imageUrl);
    if (!media) {
      console.warn(`  LINEUP_POSTER ${imageUrl} unsupported image type`);
      return [];
    }
    bytes = Buffer.from(await resp.arrayBuffer());
  } catch (err) {
    console.warn(`  LINEUP_POSTER ${imageUrl} fetch failed:`, err);
    return [];
  }
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    console.warn(`  LINEUP_POSTER ${imageUrl} image size ${bytes.length} skipped`);
    return [];
  }

  try {
    const message = await client.messages.create({
      model: REASONER_MODEL,
      // One poster, one short JSON array. Thinking off so the reply is the array.
      max_tokens: 1024,
      thinking: THINKING_DISABLED,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: media,
                data: bytes.toString("base64"),
              },
            },
            { type: "text", text: lineupPosterPrompt(years) },
          ],
        },
      ],
    });
    const text = messageText(message.content);
    if (!text) return [];
    return parseLineupReading(parseModelJson(text));
  } catch (err) {
    console.warn(`  LINEUP_POSTER ${imageUrl} read failed:`, err);
    return [];
  }
}
