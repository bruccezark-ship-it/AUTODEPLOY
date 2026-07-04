import type { DeployContext, DeployOptions, DeployResult } from '../config/schema.js';
import { build } from '../builder/vite-builder.js';
import { formatBytes, formatDuration } from '../builder/vite-builder.js';
import { ensureCdnDomain, purgeCdnCache } from '../cdn/cdn-manager.js';
import { ensureCnameRecord } from '../dns/dns-manager.js';
import { ensureBucketWebsite, uploadDirectory } from '../uploader/cos-uploader.js';

const TOTAL_STEPS = 4;

export async function deploy(
  ctx: DeployContext,
  options: DeployOptions = {},
): Promise<DeployResult> {
  const { config, projectRoot, domains, cosPrefix, outDir } = ctx;
  const clean = options.noClean === true ? false : config.project.cleanRemote;

  options.onStepStart?.(1, TOTAL_STEPS, '构建项目');
  const buildResult = await build({
    cwd: projectRoot,
    command: config.project.buildCommand,
    outDir,
  });
  options.onStepComplete?.(
    1,
    TOTAL_STEPS,
    '构建项目',
    `构建完成 (${formatDuration(buildResult.duration)}, ${buildResult.fileCount} files)`,
  );

  options.onStepStart?.(2, TOTAL_STEPS, '上传至 COS');
  await ensureBucketWebsite(config);
  const uploadResult = await uploadDirectory({
    localDir: outDir,
    remotePrefix: cosPrefix,
    config,
    clean,
  });
  options.onStepComplete?.(
    2,
    TOTAL_STEPS,
    '上传至 COS',
    `上传完成 (${uploadResult.uploaded} 新文件, ${uploadResult.skipped} 跳过, ${formatBytes(uploadResult.totalBytes)})`,
  );

  options.onStepStart?.(3, TOTAL_STEPS, '配置 CDN');
  const cosOriginPath = `/${cosPrefix.replace(/\/$/, '')}`;
  const cdnEntries = [];

  for (const entry of domains) {
    const cdnResult = await ensureCdnDomain({
      domain: entry.fullDomain,
      cosOriginPath,
      config,
      managedDns: entry.managedDns,
      onVerificationRequired: options.onCdnVerificationRequired,
    });
    cdnEntries.push({
      domain: entry.fullDomain,
      cname: cdnResult.cname,
      created: cdnResult.created,
    });
  }

  const cdnSummary = cdnEntries
    .map(({ domain, created }) => `${domain}${created ? ' (新建)' : ''}`)
    .join(', ');
  options.onStepComplete?.(3, TOTAL_STEPS, '配置 CDN', `CDN 域名已就绪: ${cdnSummary}`);

  options.onStepStart?.(4, TOTAL_STEPS, '配置 DNS 解析');
  const dnsMessages: string[] = [];

  for (let i = 0; i < domains.length; i++) {
    const entry = domains[i];
    const cdnEntry = cdnEntries[i];

    if (!entry.managedDns) {
      dnsMessages.push(`${entry.fullDomain} → 手动 CNAME ${cdnEntry.cname}`);
      continue;
    }

    const dnsResult = await ensureCnameRecord({
      subdomain: entry.dnsHost,
      cnameTarget: cdnEntry.cname,
      config,
    });
    const dnsLabel = entry.dnsHost === '@' ? '@' : entry.dnsHost;
    dnsMessages.push(
      dnsResult.action === 'skipped'
        ? `CNAME ${dnsLabel} 已正确指向 ${cdnEntry.cname}`
        : `CNAME ${dnsLabel} → ${cdnEntry.cname} (${dnsResult.action})`,
    );
  }

  options.onStepComplete?.(4, TOTAL_STEPS, '配置 DNS 解析', dnsMessages.join('; '));

  const protocol = config.domain.protocol;
  const purgeUrls = domains.flatMap((entry) => [
    `${protocol}://${entry.fullDomain}/`,
    `${protocol}://${entry.fullDomain}/index.html`,
  ]);
  await purgeCdnCache(config, purgeUrls);

  const urls = domains.map((entry) => `${protocol}://${entry.fullDomain}`);

  return {
    url: urls[0],
    urls,
    cosPath: `cos://${config.cos.bucket}/${cosPrefix}`,
    cdnCname: cdnEntries[0].cname,
    cdnEntries,
  };
}
