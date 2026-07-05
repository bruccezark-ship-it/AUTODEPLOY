import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveViteBasePath } from '../detector/vite-project.js';
import { parseRoutePaths } from '../routes/parser.js';
import { htmlToLlmMarkdown } from './html-to-md.js';
import { renderRoutePages } from './page-renderer.js';
import { normalizeBasePath, resolveSpaFile, startSpaStaticServer } from './static-server.js';

export interface GenerateSeoOptions {
  projectRoot: string;
  routeFile: string;
  outDir: string;
  baseUrl: string;
  onStatus?: (message: string) => void;
}

export interface GenerateSeoResult {
  routes: string[];
  sitemapPath: string;
  robotsPath: string;
  mdFiles: string[];
  renderedWithBrowser: boolean;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function routeToPageUrl(baseUrl: string, routePath: string): string {
  if (routePath === '/') {
    return `${normalizeBaseUrl(baseUrl)}/`;
  }
  return `${normalizeBaseUrl(baseUrl)}${routePath}`;
}

export function routeToMdFileName(routePath: string): string {
  if (routePath === '/') {
    return 'index.html.md';
  }

  const segment = routePath.replace(/^\//, '').replace(/\/$/, '');
  return `${segment.replace(/\//g, '-')}.html.md`;
}

function buildSitemapXml(urls: string[]): string {
  const body = urls
    .map((url) => `  <url>\n    <loc>${escapeXml(url)}</loc>\n  </url>`)
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    body,
    '</urlset>',
    '',
  ].join('\n');
}

function buildRobotsTxt(sitemapUrl: string): string {
  return ['User-agent: *', 'Allow: /', `Sitemap: ${sitemapUrl}`, ''].join('\n');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function hasDedicatedHtml(outDir: string, routePath: string): boolean {
  if (routePath === '/') {
    return existsSync(join(outDir, 'index.html'));
  }

  const segment = routePath.replace(/^\//, '').replace(/\/$/, '');
  return (
    existsSync(join(outDir, segment, 'index.html')) ||
    existsSync(join(outDir, `${segment}.html`))
  );
}

async function readStaticHtml(outDir: string, routePath: string): Promise<string | undefined> {
  try {
    const filePath = await resolveSpaFile(outDir, routePath === '/' ? '/' : routePath);
    return await readFile(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

async function resolveRouteHtmlMap(
  projectRoot: string,
  outDir: string,
  routes: string[],
  onStatus?: (message: string) => void,
): Promise<{ htmlByRoute: Map<string, string>; renderedWithBrowser: boolean }> {
  const needsBrowser = routes.some((route) => route !== '/' && !hasDedicatedHtml(outDir, route));

  if (!needsBrowser) {
    const htmlByRoute = new Map<string, string>();
    for (const route of routes) {
      const html = await readStaticHtml(outDir, route);
      if (html) {
        htmlByRoute.set(route, html);
      }
    }
    return { htmlByRoute, renderedWithBrowser: false };
  }

  const viteBase = await resolveViteBasePath(projectRoot);
  const server = await startSpaStaticServer(outDir, viteBase);

  try {
    const htmlByRoute = await renderRoutePages({
      serverUrl: server.url,
      routes,
      onStatus,
    });
    return { htmlByRoute, renderedWithBrowser: true };
  } finally {
    await server.close();
  }
}

export async function generateSeoArtifacts(options: GenerateSeoOptions): Promise<GenerateSeoResult> {
  const { projectRoot, routeFile, outDir, baseUrl } = options;
  const routeFilePath = join(projectRoot, routeFile);
  const content = await readFile(routeFilePath, 'utf-8');
  const routes = parseRoutePaths(content);
  const urls = routes.map((route) => routeToPageUrl(baseUrl, route));
  const sitemapUrl = `${normalizeBaseUrl(baseUrl)}/sitemap.xml`;

  const sitemapPath = join(outDir, 'sitemap.xml');
  const robotsPath = join(outDir, 'robots.txt');
  await writeFile(sitemapPath, buildSitemapXml(urls), 'utf-8');
  await writeFile(robotsPath, buildRobotsTxt(sitemapUrl), 'utf-8');

  const { htmlByRoute, renderedWithBrowser } = await resolveRouteHtmlMap(
    projectRoot,
    outDir,
    routes,
    options.onStatus,
  );

  const mdFiles: string[] = [];

  for (const route of routes) {
    const html = htmlByRoute.get(route);
    if (!html) {
      continue;
    }

    const mdFileName = routeToMdFileName(route);
    const mdPath = join(outDir, mdFileName);
    const pageUrl = routeToPageUrl(baseUrl, route);
    await writeFile(mdPath, htmlToLlmMarkdown(html, pageUrl, route), 'utf-8');
    mdFiles.push(mdFileName);
  }

  return {
    routes,
    sitemapPath,
    robotsPath,
    mdFiles,
    renderedWithBrowser,
  };
}
