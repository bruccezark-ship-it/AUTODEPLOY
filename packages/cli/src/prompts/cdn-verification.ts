import { confirm, select } from '@inquirer/prompts';
import chalk from 'chalk';
import type { CdnVerificationContext } from '@autodeploy/core';

function printVerifyRecord(ctx: CdnVerificationContext): void {
  const { record } = ctx;
  console.log();
  console.log(chalk.bold.yellow(`CDN 域名归属验证: ${record.domain}`));
  console.log(chalk.dim('请在根域名 DNS 解析区域添加以下 TXT 记录:'));
  console.log();
  console.log(`  ${chalk.dim('加速域名:')} ${chalk.cyan(record.domain)}`);
  console.log(`  ${chalk.dim('解析区域:')} ${chalk.cyan(record.rootDomain)}`);
  console.log(`  ${chalk.dim('记录类型:')} ${chalk.cyan(record.recordType)}`);
  console.log(`  ${chalk.dim('主机记录:')} ${chalk.cyan(record.host)}`);
  console.log(`  ${chalk.dim('记录值:')}   ${chalk.cyan(record.value)}`);
  console.log(`  ${chalk.dim('完整主机:')} ${chalk.cyan(record.fqdn)}`);
  console.log(
    chalk.yellow(
      '  提示: 同一根域名下的不同加速域名共用此 TXT 位置，验证新域名时需更新记录值',
    ),
  );
  console.log();
}

export async function runCdnVerificationFlow(ctx: CdnVerificationContext): Promise<void> {
  let current = ctx;

  while (true) {
    printVerifyRecord(current);

    const ready = await confirm({
      message: '已在 DNS 服务商添加上述 TXT 记录，开始验证?',
      default: false,
    });

    if (ready) {
      console.log(chalk.dim('  正在检查 DNS TXT 记录...'));
      const dnsCheck = await current.checkDns();
      if (dnsCheck.ok) {
        console.log(chalk.green(`  ✔ ${dnsCheck.message}`));
      } else {
        console.log(chalk.yellow(`  ! ${dnsCheck.message}`));
        if (dnsCheck.found.length > 0) {
          console.log(
            chalk.dim('    若刚验证过同根域名下的其他加速域名，请将 TXT 记录值更新为上方「记录值」'),
          );
        }
      }

      console.log(chalk.dim('  正在验证 CDN 域名归属...'));
      if (await current.verify()) {
        console.log(chalk.green('  ✔ CDN 域名归属验证通过'));
        return;
      }

      console.log(chalk.red('  ✖ 验证未通过，请确认 TXT 记录值与上方「记录值」完全一致'));
    }

    const action = await select<'retry' | 'refresh' | 'cancel'>({
      message: '请选择下一步',
      choices: [
        { name: '重新验证', value: 'retry' },
        { name: '重新获取验证信息', value: 'refresh' },
        { name: '取消发布', value: 'cancel' },
      ],
      default: 'retry',
    });

    if (action === 'cancel') {
      throw new Error('用户取消 CDN 域名归属验证');
    }

    if (action === 'refresh') {
      const record = await current.refresh();
      current = { ...current, record };
    }
  }
}
