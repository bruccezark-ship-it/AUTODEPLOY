import { input, confirm } from '@inquirer/prompts';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import { validateSubdomain, normalizeSubdomain } from '@autodeploy/core';

export async function runInitCommand(cwd: string): Promise<void> {
  console.log(chalk.bold('\n初始化项目配置\n'));

  const subdomain = normalizeSubdomain(
    await input({
      message: '默认子域名 (可选)',
      validate: (value) => {
        if (!value.trim()) return true;
        const result = validateSubdomain(value);
        return result === true ? true : result;
      },
    }),
  );

  const buildCommand = await input({
    message: '构建命令',
    default: 'vite build',
  });

  const outputDir = await input({
    message: '构建输出目录',
    default: 'dist',
  });

  const config: Record<string, string> = {
    buildCommand,
    outputDir,
    basePath: '/',
  };

  if (subdomain) {
    config.subdomain = subdomain;
  }

  const ok = await confirm({ message: '创建 .autodeployrc?', default: true });
  if (!ok) {
    console.log(chalk.yellow('已取消'));
    return;
  }

  const configPath = join(cwd, '.autodeployrc');
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  console.log(chalk.green(`\n✔ 已创建 ${configPath}`));
  console.log(chalk.dim('建议在 package.json 中添加: "deploy": "deploy"'));
}
