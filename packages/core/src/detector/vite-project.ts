import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export interface ViteProjectInfo {
  name: string;
  version: string;
  root: string;
  outDir: string;
}

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectError';
  }
}

export async function detectViteProject(projectRoot: string): Promise<ViteProjectInfo> {
  const pkgPath = join(projectRoot, 'package.json');

  if (!existsSync(pkgPath)) {
    throw new ProjectError('当前目录不是有效的 Node.js 项目（缺少 package.json）');
  }

  const pkg = JSON.parse(await readFile(pkgPath, 'utf-8')) as {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps.vite) {
    throw new ProjectError('当前项目不是 Vite 项目（package.json 中未找到 vite 依赖）');
  }

  const outDir = await resolveOutDir(projectRoot);

  return {
    name: pkg.name ?? 'unknown',
    version: pkg.version ?? '0.0.0',
    root: projectRoot,
    outDir,
  };
}

export async function resolveOutDir(
  projectRoot: string,
  projectOutputDir?: string,
): Promise<string> {
  if (projectOutputDir) {
    return join(projectRoot, projectOutputDir);
  }

  const viteConfigPaths = [
    'vite.config.ts',
    'vite.config.js',
    'vite.config.mjs',
    'vite.config.cjs',
  ];

  for (const configFile of viteConfigPaths) {
    const configPath = join(projectRoot, configFile);
    if (!existsSync(configPath)) continue;

    const content = await readFile(configPath, 'utf-8');
    const outDirMatch = content.match(/outDir\s*:\s*['"`]([^'"`]+)['"`]/);
    if (outDirMatch) {
      return join(projectRoot, outDirMatch[1]);
    }
  }

  return join(projectRoot, 'dist');
}
