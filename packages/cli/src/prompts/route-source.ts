import { select } from '@inquirer/prompts';
import chalk from 'chalk';
import {
  formatRouteDiscoverySummary,
  pickDefaultRouteDiscoveryOption,
  type RouteDiscoveryOption,
} from '@autodeploy/core';

function printRouteDiscoveryTables(options: RouteDiscoveryOption[]): void {
  console.log(chalk.cyan('  各方式发现的路由表:'));
  console.log();

  for (const option of options) {
    console.log(chalk.bold(`  · ${option.label} (${option.routes.length} 条)`));
    for (const route of option.routes) {
      console.log(chalk.dim(`      ${route}`));
    }
    console.log();
  }
}

export async function promptRouteDiscoverySelection(
  options: RouteDiscoveryOption[],
  deployOptions: { yes?: boolean; configuredRouteFile?: string },
): Promise<RouteDiscoveryOption | undefined> {
  if (options.length === 0) {
    return undefined;
  }

  if (options.length === 1) {
    printRouteDiscoveryTables(options);
    console.log(chalk.green(`  仅发现一种路由表，使用: ${options[0].label}`));
    console.log();
    return options[0];
  }

  printRouteDiscoveryTables(options);

  if (deployOptions.yes) {
    const selected = pickDefaultRouteDiscoveryOption(options, deployOptions.configuredRouteFile);
    if (selected) {
      console.log(chalk.yellow(`  非交互模式，使用: ${formatRouteDiscoverySummary(selected)}`));
      console.log();
    }
    return selected;
  }

  return select({
    message: '请选择用于生成 sitemap / robots / html.md 的路由表',
    choices: options.map((option) => ({
      name: formatRouteDiscoverySummary(option),
      value: option,
    })),
    default: pickDefaultRouteDiscoveryOption(options, deployOptions.configuredRouteFile),
  });
}
