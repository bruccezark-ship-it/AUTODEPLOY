import { input, confirm, select } from '@inquirer/prompts';
import chalk from 'chalk';
import {
  validateSubdomain,
  normalizeSubdomain,
  validateDomain,
  resolveDeployPlan,
  resolveSubdomainPlan,
  expandCdnDomains,
  normalizeDomain,
  type DeployPlan,
} from '@autodeploy/core';

export async function promptDeployTarget(
  baseDomain: string,
  cosPrefixBase: string,
  defaultSubdomain?: string,
): Promise<DeployPlan> {
  const mode = await select<'subdomain' | 'domain'>({
    message: '选择发布方式',
    choices: [
      { name: `子域名 (如 my-app → my-app.${baseDomain})`, value: 'subdomain' },
      { name: '完整域名 (如 app.example.com)', value: 'domain' },
    ],
    default: 'subdomain',
  });

  if (mode === 'subdomain') {
    const subdomain = normalizeSubdomain(
      await input({
        message: '请输入子域名 (不含主域名)',
        default: defaultSubdomain,
        validate: (value) => {
          const result = validateSubdomain(value);
          return result === true ? true : result;
        },
      }),
    );

    return resolveSubdomainPlan(subdomain, baseDomain, cosPrefixBase);
  }

  const fullDomainInput = await input({
    message: '请输入完整域名',
    validate: (value) => {
      const result = validateDomain(value);
      return result === true ? true : result;
    },
  });

  const plan = resolveDeployPlan(fullDomainInput, baseDomain, cosPrefixBase);
  printDeployPlanHints(fullDomainInput, plan, baseDomain);
  return plan;
}

function printDeployPlanHints(inputDomain: string, plan: DeployPlan, baseDomain: string) {
  const expanded = expandCdnDomains(normalizeDomain(inputDomain));

  if (expanded.length > 1) {
    console.log(
      chalk.cyan(`  将同时配置 CDN 加速域名: ${expanded.join(' 与 ')}`),
    );
    console.log(chalk.dim('  两个域名指向同一 COS 资源'));
  }

  if (plan.domains.some((entry) => !entry.managedDns)) {
    console.log(
      chalk.yellow(`  提示: 部分域名不在 ${baseDomain} 下，DNS 需手动配置 CNAME`),
    );
  }
}

export async function promptConfirm(
  domains: string[],
  protocol: 'http' | 'https' = 'http',
): Promise<boolean> {
  const urls = domains.map((domain) => `${protocol}://${domain}`).join(', ');
  return confirm({
    message: `确认发布至 ${chalk.cyan(urls)}?`,
    default: true,
  });
}

export function formatDeployPlanSummary(plan: DeployPlan, protocol: 'http' | 'https') {
  return {
    urls: plan.domains.map((entry) => `${protocol}://${entry.fullDomain}`).join(', '),
    cdnDomains: plan.domains.map((entry) => entry.fullDomain).join(', '),
    cosPrefix: plan.cosPrefix,
  };
}
