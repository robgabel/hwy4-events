"use client";

import { SITE_URL, SITE_NAME } from "@/lib/constants";

export default function ShareSiteLink() {
  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: SITE_NAME,
          text: "Check out Hwy 4 Events — local events along the Highway 4 corridor in the Sierra Nevada",
          url: SITE_URL,
        });
      } catch {
        // User cancelled
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(SITE_URL);
      alert("Link copied!");
    } catch {
      // Clipboard not available
    }
  }

  return (
    <button
      onClick={handleShare}
      className="cursor-pointer font-medium text-pine hover:underline"
    >
      Share with a friend
    </button>
  );
}
