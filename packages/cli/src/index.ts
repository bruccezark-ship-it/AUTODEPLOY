#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { runDeployCommand } from './commands/deploy.js';
import { runUndeployCommand } from './commands/undeploy.js';
import { runConfigCommand } from './commands/config.js';
import { runInitCommand } from './commands/init.js';

const program = new Command();

program
  .name('deploy')
  .description('Vite 项目一键发布至腾讯云 COS，自动配置 CDN 与 DNS')
  .version('0.1.0')
  .option('-delete, --delete <domain>', '下线 CDN 域名并清除 DNS 解析与 COS 资源')
  .option('-s, --subdomain <name>', '子域名（非交互模式）')
  .option('-d, --domain <name>', '完整域名（非交互模式，如 app.example.com）')
  .option('-y, --yes', '跳过确认')
  .option('--no-clean', '不清理 COS 上已删除的远程文件')
  .action(async (opts) => {
    if (opts.delete) {
      await runUndeployCommand({
        domain: opts.delete,
        yes: opts.yes,
      });
      return;
    }

    await runDeployCommand({
      subdomain: opts.subdomain,
      domain: opts.domain,
      yes: opts.yes,
      noClean: opts.clean === false,
    });
  });

program
  .command('config')
  .description('配置腾讯云凭证与域名')
  .action(async () => {
    await runConfigCommand();
  });

program
  .command('init')
  .description('初始化项目 .autodeployrc')
  .action(async () => {
    await runInitCommand(process.cwd());
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(chalk.red('发生错误:'), error instanceof Error ? error.message : error);
  process.exit(1);
});
