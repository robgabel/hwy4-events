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
 * Waits for network idle to handle Wix client-side rendering.
 */
export async function fetchPage(
  page: Page,
  url: string
): Promise<PageContent> {
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

  const title = await page.title();

  const text = await page.evaluate(() => {
    // Remove script/style elements before extracting text
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
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
