import { cdn } from 'tencentcloud-sdk-nodejs';
import type { GlobalConfig } from '../config/schema.js';
import { buildCdnVerifyRecord, formatCdnVerifyRecordMessage } from '../validate/domain.js';
import { checkTxtRecord, type TxtDnsCheckResult } from './txt-dns-check.js';
import { ensureTxtRecord } from '../dns/dns-manager.js';
import { retry } from '../utils/retry.js';

type CdnClient = InstanceType<typeof cdn.v20180606.Client>;

export interface CdnSetupOptions {
  domain: string;
  cosOriginPath: string;
  config: GlobalConfig;
  managedDns?: boolean;
  onVerificationRequired?: CdnVerificationHandler;
}

export interface CdnSetupResult {
  cname: string;
  created: boolean;
}

export interface CdnVerifyRecord {
  domain: string;
  rootDomain: string;
  host: string;
  recordType: string;
  value: string;
  fqdn: string;
}

export interface CdnVerificationContext {
  record: CdnVerifyRecord;
  verify: () => Promise<boolean>;
  checkDns: () => Promise<TxtDnsCheckResult>;
  refresh: () => Promise<CdnVerifyRecord>;
}

export type CdnVerificationHandler = (ctx: CdnVerificationContext) => Promise<void>;

export class CdnVerificationError extends Error {
  readonly record: CdnVerifyRecord;

  constructor(record: CdnVerifyRecord, message?: string) {
    super(message ?? formatCdnVerifyRecordMessage(record));
    this.name = 'CdnVerificationError';
    this.record = record;
  }
}

function createCdnClient(config: GlobalConfig): CdnClient {
  return new cdn.v20180606.Client({
    credential: {
      secretId: config.tencent.secretId,
      secretKey: config.tencent.secretKey,
    },
    profile: {
      httpProfile: { endpoint: 'cdn.tencentcloudapi.com' },
    },
  });
}

function getCosWebsiteOrigin(config: GlobalConfig): string {
  return `${config.cos.bucket}.cos-website.${config.tencent.region}.myqcloud.com`;
}

function buildOriginConfig(config: GlobalConfig, basePath?: string) {
  const origin = getCosWebsiteOrigin(config);
  return {
    Origins: [origin],
    OriginType: 'cos',
    ServerName: origin,
    CosPrivateAccess: 'off',
    OriginPullProtocol: 'http',
    ...(basePath ? { BasePath: basePath.replace(/\/$/, '') } : {}),
  };
}

function buildHttpsDomainConfig(config: GlobalConfig) {
  if (config.cdn.https && config.cdn.certId) {
    return {
      HttpsBilling: { Switch: 'on' as const },
      Https: {
        Switch: 'on' as const,
        CertInfo: { CertId: config.cdn.certId },
      },
    };
  }

  return {
    HttpsBilling: { Switch: 'off' as const },
    Https: { Switch: 'off' as const },
    ForceRedirect: { Switch: 'off' as const },
  };
}

async function applyDomainHttpsConfig(
  client: CdnClient,
  domain: string,
  config: GlobalConfig,
): Promise<void> {
  await retry(() =>
    client.UpdateDomainConfig({
      Domain: domain,
      ...buildHttpsDomainConfig(config),
    }),
  );
}

function buildErrorPageConfig(domain: string, protocol: string) {
  const origin = `${protocol}://${domain}`;
  return {
    Switch: 'on' as const,
    PageRules: [
      {
        StatusCode: 404,
        RedirectCode: 302,
        RedirectUrl: `${origin}/index.html`,
      },
    ],
  };
}

async function findDomain(client: CdnClient, domain: string) {
  const result = await client.DescribeDomains({ Filters: [{ Name: 'domain', Value: [domain] }] });
  return result.Domains?.[0];
}

function isVerifySuccess(result: unknown): boolean {
  if (typeof result === 'boolean') return result;
  if (typeof result === 'string') return result.toLowerCase() === 'true';
  return false;
}

async function tryVerifyDomain(client: CdnClient, domain: string): Promise<boolean> {
  try {
    const result = await client.VerifyDomainRecord({ Domain: domain });
    return isVerifySuccess(result.Result);
  } catch {
    return false;
  }
}

async function fetchVerifyRecord(client: CdnClient, domain: string): Promise<CdnVerifyRecord> {
  const verifyInfo = await retry(() => client.CreateVerifyRecord({ Domain: domain }));

  if (!verifyInfo.Record) {
    throw new Error('CDN 域名验证记录生成失败');
  }

  return buildCdnVerifyRecord(domain, verifyInfo);
}

async function autoVerifyWithDnsPod(
  client: CdnClient,
  domain: string,
  record: CdnVerifyRecord,
  config: GlobalConfig,
): Promise<boolean> {
  await ensureTxtRecord({ host: record.host, value: record.value, config });

  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(attempt === 0 ? 10000 : 5000);
    if (await tryVerifyDomain(client, domain)) {
      return true;
    }
  }

  return false;
}

async function ensureDomainVerified(
  client: CdnClient,
  domain: string,
  config: GlobalConfig,
  options: {
    managedDns: boolean;
    onVerificationRequired?: CdnVerificationHandler;
  },
): Promise<void> {
  if (await tryVerifyDomain(client, domain)) {
    return;
  }

  let record = await fetchVerifyRecord(client, domain);

  if (options.managedDns) {
    const verified = await autoVerifyWithDnsPod(client, domain, record, config);
    if (verified) {
      return;
    }
  }

  if (options.onVerificationRequired) {
    await options.onVerificationRequired({
      record,
      verify: () => tryVerifyDomain(client, domain),
      checkDns: () => checkTxtRecord(record.fqdn, record.value),
      refresh: async () => {
        record = await fetchVerifyRecord(client, domain);
        return record;
      },
    });

    if (await tryVerifyDomain(client, domain)) {
      return;
    }

    throw new CdnVerificationError(record, 'CDN 域名归属验证未通过');
  }

  throw new CdnVerificationError(record);
}

export async function ensureCdnDomain(options: CdnSetupOptions): Promise<CdnSetupResult> {
  const { domain, cosOriginPath, config, managedDns = true, onVerificationRequired } = options;
  const client = createCdnClient(config);
  const originPath = cosOriginPath.replace(/\/$/, '');

  const existing = await findDomain(client, domain);
  let created = false;

  if (!existing) {
    await ensureDomainVerified(client, domain, config, {
      managedDns,
      onVerificationRequired,
    });
    await retry(() =>
      client.AddCdnDomain({
        Domain: domain,
        ServiceType: config.cdn.serviceType,
        Origin: buildOriginConfig(config, originPath),
        Area: config.cdn.area,
      }),
    );
    created = true;

    await sleep(5000);
  }

  const cacheRules = config.cdn.defaultCacheRules.map((rule) => ({
    CacheType: rule.type,
    CacheContents: rule.rule.split(',').map((s) => s.trim()),
    CacheTime: rule.ttl,
  }));

  await retry(() =>
    client.UpdateDomainConfig({
      Domain: domain,
      Origin: buildOriginConfig(config, originPath),
      Cache: {
        SimpleCache: {
          CacheRules: cacheRules,
          FollowOrigin: 'off',
          IgnoreCacheControl: 'off',
          IgnoreSetCookie: 'off',
          CompareMaxAge: 'off',
        },
      },
      ErrorPage: buildErrorPageConfig(domain, config.domain.protocol),
    }),
  );

  await applyDomainHttpsConfig(client, domain, config);

  const domainInfo = await findDomain(client, domain);
  const cname = domainInfo?.Cname ?? `${domain}.cdn.dnsv1.com`;

  return { cname, created };
}

export async function purgeCdnCache(
  config: GlobalConfig,
  urls: string[],
): Promise<void> {
  if (urls.length === 0) return;

  const client = createCdnClient(config);
  await retry(() => client.PurgeUrlsCache({ Urls: urls }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
