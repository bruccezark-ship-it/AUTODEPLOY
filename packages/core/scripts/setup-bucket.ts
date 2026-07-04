/**
 * 一次性 COS 存储桶初始化脚本
 *
 * 用法（在仓库根目录）:
 *   pnpm setup-bucket
 *
 * 需先在 ~/.autodeploy/config.json 中配置腾讯云凭证
 */
import { loadGlobalConfig } from '../src/config/loader.js';
import { ensureBucketWebsite } from '../src/uploader/cos-uploader.js';

async function main() {
  const config = await loadGlobalConfig();
  const { bucket } = config.cos;
  const { region } = config.tencent;

  console.log(`配置存储桶静态网站: ${bucket} (${region})`);

  await ensureBucketWebsite(config);

  console.log('✔ 静态网站配置完成');
  console.log('  IndexDocument: index.html');
  console.log('  ErrorDocument: index.html (SPA fallback)');
  console.log('\n请确保:');
  console.log('  1. 存储桶访问权限为「公有读私有写」');
  console.log('  2. CDN 控制台已绑定 *.yourdomain.com HTTPS 证书');
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('初始化失败:', message);
  process.exit(1);
});
