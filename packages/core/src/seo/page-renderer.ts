import type { Browser, Page } from 'playwright-core';

type ChromiumModule = {
  launch: (options: Record<string, unknown>) => Promise<Browser>;
};

const BROWSER_CHANNELS = ['msedge', 'chrome', 'chrome-beta'] as const;

async function launchBrowser(chromium: ChromiumModule): Promise<Browser> {
  for (const channel of BROWSER_CHANNELS) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      // try next channel
    }
  }

  try {
    return await chromium.launch({ headless: true });
  } catch {
    throw new Error(
      '无法启动浏览器以抓取 SPA 页面内容。请安装 Chrome/Edge，或执行: npx playwright install chromium',
    );
  }
}

function buildLocalUrl(serverUrl: string, routePath: string): string {
  const base = serverUrl.replace(/\/$/, '');
  if (routePath === '/') {
    return `${base}/`;
  }
  return `${base}${routePath.startsWith('/') ? routePath : `/${routePath}`}`;
}

async function waitForPageContent(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await Promise.race([
    page.waitForLoadState('networkidle'),
    page.waitForTimeout(3000),
  ]).catch(() => undefined);

  await page.locator('main, #app, #root, body').first().waitFor({ state: 'attached', timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(1000);
}

/** 使用无头浏览器渲染各路由，抓取 SPA 页面最终 HTML */
export async function renderRoutePages(options: {
  serverUrl: string;
  routes: string[];
}): Promise<Map<string, string>> {
  const { chromium } = await import('playwright-core');
  const browser = await launchBrowser(chromium as ChromiumModule);
  const page = await browser.newPage();
  const results = new Map<string, string>();

  try {
    for (const route of options.routes) {
      const url = buildLocalUrl(options.serverUrl, route);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitForPageContent(page);
      results.set(route, await page.content());
    }
  } finally {
    await browser.close();
  }

  return results;
}
