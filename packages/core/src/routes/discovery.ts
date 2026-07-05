import fg from 'fast-glob';

const ROUTE_GLOB_PATTERNS = [
  'src/router/**/*.{ts,tsx,js,jsx,mjs,cjs}',
  'src/routes/**/*.{ts,tsx,js,jsx,mjs,cjs}',
  'src/**/routes.{ts,tsx,js,jsx,mjs,cjs}',
  'src/**/router.{ts,tsx,js,jsx,mjs,cjs}',
  'router/**/*.{ts,tsx,js,jsx,mjs,cjs}',
  'routes/**/*.{ts,tsx,js,jsx,mjs,cjs}',
];

const IGNORE = ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/coverage/**'];

/** 扫描 Vite 项目中可能的路由定义文件 */
export async function discoverRouteFiles(projectRoot: string): Promise<string[]> {
  const matches = await fg(ROUTE_GLOB_PATTERNS, {
    cwd: projectRoot,
    absolute: false,
    ignore: IGNORE,
    onlyFiles: true,
    followSymbolicLinks: true,
  });

  const normalized = [...new Set(matches.map((file) => file.replace(/\\/g, '/')))];
  normalized.sort((a, b) => a.localeCompare(b));
  return normalized;
}
