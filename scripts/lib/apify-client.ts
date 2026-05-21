import axios from "axios";

/**
 * Thin wrapper around Apify's run-sync-get-dataset-items endpoint.
 *
 * Each Apify actor we use (facebook-posts-scraper, facebook-events-scraper)
 * has a slightly different input shape and return type, but the scaffolding
 * — auth, sync-run endpoint, response shape check — is identical. This module
 * owns that scaffolding so the two FB libs can focus on actor-specific input
 * construction and output mapping.
 *
 * Throws on missing token or HTTP failure; returns `[]` if the actor finished
 * but returned a non-array response (which Apify occasionally does on
 * boot-strap problems).
 */
const SYNC_ENDPOINT = (actor: string) =>
  `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items`;

export interface RunApifyActorOpts {
  /** Actor slug, e.g. "apify~facebook-posts-scraper". */
  actor: string;
  /** Input payload for the actor — shape is actor-specific. */
  input: Record<string, unknown>;
  /** Request timeout in ms (Apify sync runs are slow). Default 120s. */
  timeoutMs?: number;
}

export function getApifyToken(): string | null {
  return process.env.APIFY_API_TOKEN || null;
}

export function requireApifyToken(): string {
  const token = getApifyToken();
  if (!token) {
    throw new Error("Missing APIFY_API_TOKEN environment variable");
  }
  return token;
}

export async function runApifyActorSync<T = unknown>(
  opts: RunApifyActorOpts
): Promise<T[]> {
  const token = requireApifyToken();
  const response = await axios.post(SYNC_ENDPOINT(opts.actor), opts.input, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    timeout: opts.timeoutMs ?? 120000,
  });

  if (!Array.isArray(response.data)) {
    console.warn(`  Apify returned unexpected response type: ${typeof response.data}`);
    return [];
  }
  return response.data as T[];
}
