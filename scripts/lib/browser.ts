import { chromium, type Browser, type Page } from "playwright";

export interface PageContent {
  title: string;
  text: string;
  links: string[];
  url: string;
}

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

/**
 * Fetch a page and extract its text content and links.
 * Scrolls the page and waits for dynamic content (Wix sites load lazily).
 */
export async function fetchPage(
  page: Page,
  url: string,
  options?: { scrollAndWait?: boolean }
): Promise<PageContent> {
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

  if (options?.scrollAndWait) {
    // Scroll down incrementally to trigger lazy-loaded content
    await page.evaluate(async () => {
      const scrollStep = 500;
      const scrollDelay = 300;
      let currentPos = 0;
      const maxScroll = document.body.scrollHeight;
      while (currentPos < maxScroll) {
        currentPos += scrollStep;
        window.scrollTo(0, currentPos);
        await new Promise((r) => setTimeout(r, scrollDelay));
      }
      // Scroll back to top
      window.scrollTo(0, 0);
    });
    // Wait for any newly triggered network requests to settle
    await page.waitForLoadState("networkidle");
    // Extra wait for Wix widget rendering
    await page.waitForTimeout(3000);
  }

  const title = await page.title();

  const text = await page.evaluate(() => {
    // Remove script/style elements before extracting text
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("script, style, noscript, iframe").forEach((el) => el.remove());
    return clone.innerText || "";
  });

  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]"))
      .map((a) => (a as HTMLAnchorElement).href)
      .filter(Boolean)
  );

  return { title, text, links, url };
}

/**
 * Polite delay between page fetches.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
