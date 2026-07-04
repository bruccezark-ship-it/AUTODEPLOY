import { input, confirm, select } from '@inquirer/prompts';
import chalk from 'chalk';
import {
  createDefaultGlobalConfig,
  saveGlobalConfig,
  globalConfigSchema,
  type GlobalConfig,
} from '@autodeploy/core';
import { getGlobalConfigPath } from '@autodeploy/core';

export async function runConfigCommand(): Promise<void> {
  console.log(chalk.bold('\nAutoDeploy 全局配置\n'));
  console.log(chalk.dim(`配置文件: ${getGlobalConfigPath()}\n`));

  const defaults = createDefaultGlobalConfig();

  const secretId = await input({
    message: '腾讯云 SecretId',
    default: defaults.tencent.secretId || undefined,
    validate: (v) => (v.trim() ? true : 'SecretId 不能为空'),
  });

  const secretKey = await input({
    message: '腾讯云 SecretKey',
    validate: (v) => (v.trim() ? true : 'SecretKey 不能为空'),
  });

  const region = await input({
    message: 'COS 地域 (如 ap-guangzhou)',
    default: defaults.tencent.region,
  });

  const bucket = await input({
    message: 'COS 存储桶名称 (如 static-sites-1250000000)',
    validate: (v) => (v.trim() ? true : '存储桶名称不能为空'),
  });

  const baseDomain = await input({
    message: '主域名 (如 example.com)',
    validate: (v) => (v.trim() ? true : '主域名不能为空'),
  });

  const prefix = await input({
    message: 'COS 路径前缀',
    default: 'sites',
  });

  const protocol = await select<'http' | 'https'>({
    message: '默认访问协议',
    choices: [
      { name: 'HTTP', value: 'http' },
      { name: 'HTTPS', value: 'https' },
    ],
    default: 'http',
  });

  const cdnHttps = await confirm({
    message: '是否开启 CDN HTTPS 访问?',
    default: false,
  });

  let certId = '';
  if (cdnHttps) {
    certId = (
      await input({
        message: 'CDN HTTPS 证书 ID',
        validate: (v) => (v.trim() ? true : '开启 HTTPS 时必须填写证书 ID'),
      })
    ).trim();
  }

  const mainlandRegions = ['ap-guangzhou', 'ap-shanghai', 'ap-beijing', 'ap-nanjing', 'ap-chengdu', 'ap-chongqing'];
  const defaultArea = mainlandRegions.includes(region.trim()) ? 'mainland' : 'overseas';

  const area = await input({
    message: 'CDN 加速区域 (mainland=中国境内需备案, overseas=境外, global=全球)',
    default: defaultArea,
    validate: (v) => {
      const value = v.trim();
      return ['mainland', 'overseas', 'global'].includes(value)
        ? true
        : '请输入 mainland、overseas 或 global';
    },
  });

  const config: GlobalConfig = {
    tencent: { secretId: secretId.trim(), secretKey: secretKey.trim(), region: region.trim() },
    cos: { bucket: bucket.trim(), prefix: prefix.trim() },
    cdn: {
      serviceType: 'web',
      area: area.trim() as 'mainland' | 'overseas' | 'global',
      https: cdnHttps,
      certId: certId || undefined,
      defaultCacheRules: defaults.cdn.defaultCacheRules,
    },
    dns: { domain: baseDomain.trim(), recordLine: '默认', ttl: 600 },
    domain: { baseDomain: baseDomain.trim(), protocol },
  };

  const parsed = globalConfigSchema.parse(config);

  const ok = await confirm({ message: '保存配置?', default: true });
  if (!ok) {
    console.log(chalk.yellow('已取消'));
    return;
  }

  await saveGlobalConfig(parsed);
  console.log(chalk.green(`\n✔ 配置已保存至 ${getGlobalConfigPath()}`));
}
