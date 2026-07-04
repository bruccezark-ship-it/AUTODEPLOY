import { cosmiconfig } from 'cosmiconfig';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import {
  globalConfigSchema,
  projectConfigSchema,
  type DeployConfig,
  type GlobalConfig,
  type ProjectConfig,
} from './schema.js';

const GLOBAL_CONFIG_DIR = join(homedir(), '.autodeploy');
const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, 'config.json');

const projectExplorer = cosmiconfig('autodeploy');

function applyEnvOverrides(config: Partial<GlobalConfig>): Partial<GlobalConfig> {
  const result = { ...config };

  if (process.env.TENCENT_SECRET_ID || process.env.TENCENT_SECRET_KEY) {
    result.tencent = {
      secretId: process.env.TENCENT_SECRET_ID ?? config.tencent?.secretId ?? '',
      secretKey: process.env.TENCENT_SECRET_KEY ?? config.tencent?.secretKey ?? '',
      region: process.env.TENCENT_CLOUD_REGION ?? config.tencent?.region ?? 'ap-guangzhou',
    };
  }

  if (process.env.AUTODEPLOY_COS_BUCKET) {
    result.cos = {
      bucket: process.env.AUTODEPLOY_COS_BUCKET,
      prefix: process.env.AUTODEPLOY_COS_PREFIX ?? config.cos?.prefix ?? 'sites',
    };
  }

  if (process.env.AUTODEPLOY_BASE_DOMAIN) {
    const baseDomain = process.env.AUTODEPLOY_BASE_DOMAIN;
    result.domain = { baseDomain, protocol: config.domain?.protocol ?? 'http' };
    result.dns = { domain: baseDomain, recordLine: config.dns?.recordLine ?? '默认', ttl: config.dns?.ttl ?? 600 };
  }

  return result;
}

export async function loadGlobalConfig(): Promise<GlobalConfig> {
  if (!existsSync(GLOBAL_CONFIG_PATH)) {
    throw new ConfigError(
      `未找到全局配置文件: ${GLOBAL_CONFIG_PATH}\n请运行 deploy config 进行初始化`,
    );
  }

  const raw = JSON.parse(await readFile(GLOBAL_CONFIG_PATH, 'utf-8'));
  const merged = applyEnvOverrides(raw);
  return globalConfigSchema.parse(merged);
}

export async function saveGlobalConfig(config: GlobalConfig): Promise<void> {
  await mkdir(GLOBAL_CONFIG_DIR, { recursive: true });
  await writeFile(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  await chmod(GLOBAL_CONFIG_PATH, 0o600);
}

export async function loadProjectConfig(projectRoot: string): Promise<ProjectConfig> {
  const result = await projectExplorer.search(projectRoot);
  const raw = result?.config ?? {};
  return projectConfigSchema.parse(raw);
}

export async function saveProjectConfig(
  projectRoot: string,
  config: ProjectConfig,
): Promise<void> {
  const configPath = join(projectRoot, '.autodeployrc');
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export async function loadDeployConfig(projectRoot: string): Promise<DeployConfig> {
  const [global, project] = await Promise.all([
    loadGlobalConfig(),
    loadProjectConfig(projectRoot),
  ]);

  if (global.dns.domain !== global.domain.baseDomain) {
    global.dns.domain = global.domain.baseDomain;
  }

  return { ...global, project };
}

export function getGlobalConfigPath(): string {
  return GLOBAL_CONFIG_PATH;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function createDefaultGlobalConfig(): GlobalConfig {
  return {
    tencent: {
      secretId: '',
      secretKey: '',
      region: 'ap-guangzhou',
    },
    cos: {
      bucket: '',
      prefix: 'sites',
    },
    cdn: {
      serviceType: 'web',
      area: 'mainland',
      https: false,
      defaultCacheRules: [
        { type: 'file', rule: 'html', ttl: 0 },
        { type: 'file', rule: 'js,css', ttl: 2592000 },
        { type: 'file', rule: 'jpg,png,svg,webp,ico,woff,woff2', ttl: 2592000 },
      ],
    },
    dns: {
      domain: 'example.com',
      recordLine: '默认',
      ttl: 600,
    },
    domain: {
      baseDomain: 'example.com',
      protocol: 'http',
    },
  };
}
