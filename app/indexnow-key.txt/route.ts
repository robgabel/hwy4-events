// IndexNow key file (HWY-62). Search engines fetch this to confirm the key in a
// submission belongs to this host. The key is public by design; it lives in
// region config (INDEXNOW_KEY env overrides) so each deployment has its own.
import { REGION_OPS } from "@/lib/region-ops";
import { resolveIndexNowKey } from "@/lib/indexnow";

export function GET() {
  const key = resolveIndexNowKey(process.env.INDEXNOW_KEY, REGION_OPS.seo.indexNowKey);
  if (!key) return new Response("Not found", { status: 404 });
  return new Response(key, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
