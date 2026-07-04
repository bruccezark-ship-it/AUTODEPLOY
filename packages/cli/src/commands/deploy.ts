import chalk from 'chalk';
import ora from 'ora';
import {
  detectViteProject,
  resolveOutDir,
  loadDeployConfig,
  deploy,
  validateSubdomain,
  normalizeSubdomain,
  validateDomain,
  resolveDeployPlan,
  resolveSubdomainPlan,
  expandCdnDomains,
  normalizeDomain,
  enrichDeployPlanDns,
  getDnsZoneDetails,
  getRootDomain,
  ConfigError,
  ProjectError,
  CdnVerificationError,
  type DeployPlan,
} from '@autodeploy/core';
import {
  promptDeployTarget,
  promptConfirm,
  formatDeployPlanSummary,
} from '../prompts/deploy-target.js';
import { promptDeploySettings } from '../prompts/deploy-settings.js';
import { runCdnVerificationFlow } from '../prompts/cdn-verification.js';

export interface DeployCommandOptions {
  subdomain?: string;
  domain?: string;
  yes?: boolean;
  noClean?: boolean;
  cwd?: string;
}

function buildPlanFromDomain(domain: string, baseDomain: string, cosPrefixBase: string) {
  const validation = validateDomain(domain);
  if (validation !== true) {
    return { error: validation } as const;
  }

  return { plan: resolveDeployPlan(domain, baseDomain, cosPrefixBase) } as const;
}

function printPlanInfo(plan: DeployPlan, inputDomain: string | undefined, protocol: string) {
  if (inputDomain) {
    const expanded = expandCdnDomains(normalizeDomain(inputDomain));
    if (expanded.length > 1) {
      console.log(chalk.cyan(`  将同时配置 CDN 加速域名: ${expanded.join(' 与 ')}`));
      console.log(chalk.dim('  两个域名指向同一 COS 资源'));
    }
  }

  const summary = formatDeployPlanSummary(plan, protocol as 'http' | 'https');
  console.log(chalk.dim(`  访问地址: ${chalk.cyan(summary.urls)}`));
  console.log(chalk.dim(`  加速域名: ${chalk.cyan(summary.cdnDomains)}`));
  console.log(chalk.dim(`  COS 上传路径: ${chalk.cyan(summary.cosPrefix)}`));
}

async function enrichAndPrintDnsStatus(
  plan: DeployPlan,
  config: Awaited<ReturnType<typeof loadDeployConfig>>,
): Promise<DeployPlan> {
  const spinner = ora('检测域名是否在当前腾讯云账户下...').start();

  try {
    const enriched = await enrichDeployPlanDns(plan, config);
    spinner.stop();

    const seenZones = new Set<string>();
    for (const entry of enriched.domains) {
      const zoneKey = entry.dnsZone ?? entry.fullDomain;
      if (seenZones.has(zoneKey)) continue;
      seenZones.add(zoneKey);

      const details = await getDnsZoneDetails(config, zoneKey);

      if (details.inAccount && details.effective) {
        console.log(
          chalk.green(
            `✔ 解析区域 ${entry.dnsZone} 已在 DNSPod 账户且 NS 已生效，将自动完成 CDN 归属验证与 DNS 解析`,
          ),
        );
      } else if (details.inAccount) {
        console.log(
          chalk.yellow(
            `! 解析区域 ${entry.dnsZone} 在 DNSPod 账户中，但 NS 未指向 DNSPod，需手动配置 TXT/CNAME`,
          ),
        );
        if (details.actualNs.length > 0) {
          console.log(chalk.dim(`  当前 NS: ${details.actualNs.join(', ')}`));
        }
        if (details.dnspodNs.length > 0) {
          console.log(chalk.dim(`  DNSPod NS: ${details.dnspodNs.join(', ')}`));
        }
      } else {
        console.log(
          chalk.yellow(
            `! 解析区域 ${entry.dnsZone} 不在当前账户下，需手动完成 CDN 归属验证与 DNS 配置`,
          ),
        );
      }
    }

    console.log();
    return enriched;
  } catch (error) {
    spinner.warn('域名账户检测失败，将按外部域名处理（需手动 CDN 验证）');
    const message = error instanceof Error ? error.message : String(error);
    if (message) {
      console.log(chalk.dim(`  ${message}`));
    }

    const fallbackPlan: DeployPlan = {
      ...plan,
      domains: plan.domains.map((entry) => ({
        ...entry,
        managedDns: false,
        dnsZone: getRootDomain(entry.fullDomain),
        dnsHost: entry.fullDomain,
      })),
    };

    for (const entry of fallbackPlan.domains) {
      console.log(
        chalk.yellow(
          `! 解析区域 ${entry.dnsZone} 不在当前账户下，需手动完成 CDN 归属验证与 DNS 配置`,
        ),
      );
    }

    console.log();
    return fallbackPlan;
  }
}

export async function runDeployCommand(options: DeployCommandOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  if (options.subdomain && options.domain) {
    console.error(chalk.red('\n✖ --subdomain 与 --domain 不能同时使用'));
    process.exit(1);
  }

  let config;
  try {
    config = await loadDeployConfig(cwd);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(chalk.red(`\n✖ ${error.message}`));
      process.exit(1);
    }
    throw error;
  }

  let projectInfo;
  try {
    projectInfo = await detectViteProject(cwd);
  } catch (error) {
    if (error instanceof ProjectError) {
      console.error(chalk.red(`\n✖ ${error.message}`));
      process.exit(1);
    }
    throw error;
  }

  const outDir = await resolveOutDir(cwd, config.project.outputDir);

  console.log(chalk.green(`✔ 检测到 Vite 项目: ${projectInfo.name}@${projectInfo.version}`));
  console.log(chalk.green(`✔ 构建输出目录: ${config.project.outputDir ?? 'dist'}`));
  console.log();

  let plan: DeployPlan;
  let inputDomain: string | undefined;

  if (options.domain) {
    const parsed = buildPlanFromDomain(options.domain, config.domain.baseDomain, config.cos.prefix);
    if ('error' in parsed) {
      console.error(chalk.red(`\n✖ ${parsed.error}`));
      process.exit(1);
    }
    plan = parsed.plan;
    inputDomain = options.domain;
  } else if (options.subdomain) {
    const validation = validateSubdomain(options.subdomain);
    if (validation !== true) {
      console.error(chalk.red(`\n✖ ${validation}`));
      process.exit(1);
    }
    plan = resolveSubdomainPlan(
      normalizeSubdomain(options.subdomain),
      config.domain.baseDomain,
      config.cos.prefix,
    );
  } else {
    plan = await promptDeployTarget(
      config.domain.baseDomain,
      config.cos.prefix,
      config.project.subdomain,
    );
  }

  plan = await enrichAndPrintDnsStatus(plan, config);

  if (!options.yes) {
    const settings = await promptDeploySettings({
      protocol: config.domain.protocol,
      cdnHttps: config.cdn.https,
      certId: config.cdn.certId,
    });

    config = {
      ...config,
      domain: { ...config.domain, protocol: settings.protocol },
      cdn: {
        ...config.cdn,
        https: settings.cdnHttps,
        certId: settings.certId ?? config.cdn.certId,
      },
    };

    console.log();
    printPlanInfo(plan, inputDomain, settings.protocol);
    console.log();

    const confirmed = await promptConfirm(
      plan.domains.map((entry) => entry.fullDomain),
      settings.protocol,
    );
    if (!confirmed) {
      console.log(chalk.yellow('\n已取消发布'));
      return;
    }
  } else {
    console.log();
    printPlanInfo(plan, inputDomain, config.domain.protocol);
    console.log();
  }

  if (config.cdn.https && !config.cdn.certId) {
    console.error(chalk.red('\n✖ 已开启 CDN HTTPS，但未配置证书 ID。请运行 deploy config 或交互式发布时填写。'));
    process.exit(1);
  }

  console.log();

  const spinners = new Map<number, ReturnType<typeof ora>>();

  try {
    const result = await deploy(
      {
        projectRoot: cwd,
        cosPrefix: plan.cosPrefix,
        domains: plan.domains,
        config,
        outDir,
      },
      {
        noClean: options.noClean,
        onCdnVerificationRequired: options.yes
          ? undefined
          : async (verificationCtx) => {
              spinners.get(2)?.stop();
              await runCdnVerificationFlow(verificationCtx);
            },
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
    console.log(chalk.bold.green('🎉 发布成功!'));
    for (const url of result.urls) {
      console.log(`   访问地址: ${chalk.cyan(url)}`);
    }
    console.log(`   COS 路径: ${chalk.dim(result.cosPath)}`);
    for (const entry of result.cdnEntries) {
      console.log(`   CDN ${entry.domain}: ${chalk.dim(entry.cname)}`);
    }

    const manualDns = plan.domains.filter((entry) => !entry.managedDns);
    if (manualDns.length > 0) {
      console.log(chalk.yellow('   请手动配置以下域名的 CNAME:'));
      for (const entry of manualDns) {
        const cdnEntry = result.cdnEntries.find((item) => item.domain === entry.fullDomain);
        if (cdnEntry) {
          console.log(chalk.yellow(`     ${entry.fullDomain} → ${cdnEntry.cname}`));
        }
      }
    }
  } catch (error) {
    for (const spinner of spinners.values()) {
      spinner.fail();
    }

    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof CdnVerificationError) {
      console.error(chalk.red('\n✖ 发布失败: CDN 域名归属验证未完成'));
      console.error(chalk.yellow('\n' + message));
    } else {
      console.error(chalk.red(`\n✖ 发布失败: ${message}`));
    }

    if (message.includes('备案')) {
      console.error(
        chalk.yellow(
          '\n提示: 中国境内 CDN (cdn.area=mainland) 要求域名 ICP 备案。\n' +
            '      若 COS 在新加坡等境外地域，请将 ~/.autodeploy/config.json 中 cdn.area 改为 "overseas" 后重试。',
        ),
      );
    }

    if (error instanceof Error && 'output' in error && error.output) {
      console.error(chalk.dim(String(error.output)));
    }

    process.exit(1);
  }
}
