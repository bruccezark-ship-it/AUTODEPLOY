import { confirm, input, select } from '@inquirer/prompts';
import chalk from 'chalk';

export interface DeploySettingsResult {
  protocol: 'http' | 'https';
  cdnHttps: boolean;
  certId?: string;
}

export async function promptDeploySettings(
  defaults: {
    protocol?: 'http' | 'https';
    cdnHttps?: boolean;
    certId?: string;
  } = {},
): Promise<DeploySettingsResult> {
  const protocol = await select<'http' | 'https'>({
    message: '选择访问协议',
    choices: [
      { name: 'HTTP', value: 'http' },
      { name: 'HTTPS', value: 'https' },
    ],
    default: defaults.protocol ?? 'http',
  });

  const cdnHttps = await confirm({
    message: '是否开启 CDN HTTPS 访问?',
    default: defaults.cdnHttps ?? false,
  });

  let certId = defaults.certId;

  if (cdnHttps && !certId) {
    certId = (
      await input({
        message: 'CDN HTTPS 证书 ID',
        validate: (value) => (value.trim() ? true : '开启 HTTPS 时必须填写证书 ID'),
      })
    ).trim();
  }

  console.log(chalk.dim(`  CDN HTTPS: ${cdnHttps ? chalk.green('开启') : chalk.yellow('关闭')}`));

  return { protocol, cdnHttps, certId };
}
