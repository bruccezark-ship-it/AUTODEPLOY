import { select } from '@inquirer/prompts';
import chalk from 'chalk';
import { discoverRouteFiles } from '@autodeploy/core';

function printRouteFileList(files: string[]): void {
  console.log(chalk.cyan(`  检测到 ${files.length} 个路由文件:`));
  for (const file of files) {
    console.log(chalk.dim(`    · ${file}`));
  }
  console.log();
}

export async function resolveRouteFileForDeploy(options: {
  projectRoot: string;
  configuredRouteFile?: string;
  yes?: boolean;
}): Promise<string | undefined> {
  const files = await discoverRouteFiles(options.projectRoot);

  if (files.length === 0) {
    return undefined;
  }

  if (options.configuredRouteFile) {
    const normalizedConfig = options.configuredRouteFile.replace(/\\/g, '/');
    const matched = files.find((file) => file === normalizedConfig);
    if (matched) {
      printRouteFileList(files);
      console.log(chalk.green(`  使用 .autodeployrc 配置的路由文件: ${matched}`));
      console.log();
      return matched;
    }

    console.log(
      chalk.yellow(
        `  配置的 routeFile "${options.configuredRouteFile}" 未找到，请重新选择`,
      ),
    );
    console.log();
  }

  printRouteFileList(files);

  if (options.yes) {
    console.log(
      chalk.yellow(`  非交互模式，使用第一个路由文件: ${files[0]}`),
    );
    console.log();
    return files[0];
  }

  return select({
    message: '请选择用于生成 sitemap / robots / html.md 的路由文件',
    choices: files.map((file) => ({ name: file, value: file })),
    default: files[0],
  });
}
