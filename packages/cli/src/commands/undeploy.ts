import { confirm, input } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import {
  loadGlobalConfig,
  undeploy,
  validateDomain,
  normalizeDomain,
  resolveCosPrefixFromDomain,
  parseFullDomain,
  ConfigError,
} from '@autodeploy/core';

export interface UndeployCommandOptions {
  domain?: string;
  yes?: boolean;
}

export async function runUndeployCommand(options: UndeployCommandOptions): Promise<void> {
  let config;
  try {
    config = await loadGlobalConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(chalk.red(`\n✖ ${error.message}`));
      process.exit(1);
    }
    throw error;
  }

  let domain = options.domain;

  if (!domain) {
    domain = await input({
      message: '请输入要下线的 CDN 加速域名',
      validate: (value) => {
        const result = validateDomain(value);
        return result === true ? true : result;
      },
    });
  } else {
    const validation = validateDomain(domain);
    if (validation !== true) {
      console.error(chalk.red(`\n✖ ${validation}`));
      process.exit(1);
    }
  }

  domain = normalizeDomain(domain);
  const { cosPrefix, sharedDomains } = resolveCosPrefixFromDomain(
    domain,
    config.domain.baseDomain,
    config.cos.prefix,
  );

  const dnsTarget = parseFullDomain(domain, config.domain.baseDomain);

  console.log();
  console.log(chalk.dim(`  CDN 域名: ${chalk.cyan(domain)}`));
  console.log(chalk.dim(`  COS 路径: ${chalk.cyan(cosPrefix)}`));
  if (dnsTarget.managedDns) {
    const dnsLabel = dnsTarget.dnsHost === '@' ? '@' : dnsTarget.dnsHost;
    console.log(chalk.dim(`  DNS 记录: ${chalk.cyan(`CNAME ${dnsLabel}.${config.dns.domain}`)}`));
  } else {
    console.log(chalk.yellow(`  提示: 域名不在 ${config.dns.domain} 下，DNS 需手动清理`));
  }
  if (sharedDomains.length > 1) {
    console.log(
      chalk.yellow(
        `  提示: 与 ${sharedDomains.filter((d) => d !== domain).join('、')} 共用 COS 路径，若其仍在线则不会删除 COS 资源`,
      ),
    );
  }
  console.log();

  if (!options.yes) {
    const confirmed = await confirm({
      message: `确认下线 ${chalk.cyan(domain)} 并清理 CDN / DNS / COS 资源?`,
      default: false,
    });
    if (!confirmed) {
      console.log(chalk.yellow('\n已取消'));
      return;
    }
  }

  console.log();
  const spinners = new Map<number, ReturnType<typeof ora>>();

  try {
    const result = await undeploy(
      { domain, config },
      {
        onStepStart: (step, total, name) => {
          const spinner = ora(`[${step}/${total}] ${name}...`).start();
          spinners.set(step, spinner);
        },
        onStepComplete: (step, _total, _name, message) => {
          spinners.get(step)?.succeed(message);
        },
      },
    );

    console.log();
    console.log(chalk.bold.green('✔ 下线完成'));
    console.log(`   CDN: ${result.cdnStatus === 'removed' ? chalk.green('已删除') : chalk.yellow('未找到')}`);
    if (result.dnsStatus === 'skipped') {
      console.log(`   DNS: ${chalk.yellow(result.dnsSkipReason ?? '已跳过')}`);
    } else if (result.dnsStatus === 'deleted') {
      console.log(`   DNS: ${chalk.green('CNAME 已删除')}`);
    } else {
      console.log(`   DNS: ${chalk.yellow('未找到 CNAME 记录')}`);
    }
    if (result.cosSkipped) {
      console.log(`   COS: ${chalk.yellow(result.cosSkipReason ?? '已跳过')}`);
    } else {
      console.log(`   COS: ${chalk.green(`已删除 ${result.cosDeleted} 个对象`)} (${result.cosPrefix})`);
    }
  } catch (error) {
    for (const spinner of spinners.values()) {
      spinner.fail();
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`\n✖ 下线失败: ${message}`));
    process.exit(1);
  }
}
