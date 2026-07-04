import { dnspod } from 'tencentcloud-sdk-nodejs';
import type { GlobalConfig } from '../config/schema.js';
import { retry } from '../utils/retry.js';

type DnsClient = InstanceType<typeof dnspod.v20210323.Client>;

export interface DnsSetupOptions {
  subdomain: string;
  cnameTarget: string;
  config: GlobalConfig;
}

export interface DnsSetupResult {
  action: 'created' | 'updated' | 'skipped';
  recordId?: number;
}

function createDnsClient(config: GlobalConfig): DnsClient {
  return new dnspod.v20210323.Client({
    credential: {
      secretId: config.tencent.secretId,
      secretKey: config.tencent.secretKey,
    },
    profile: {
      httpProfile: { endpoint: 'dnspod.tencentcloudapi.com' },
    },
  });
}

function normalizeCname(value: string): string {
  return value.replace(/\.$/, '').toLowerCase();
}

function isEmptyRecordListError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('记录列表为空') ||
    message.includes('NoDataOfRecord') ||
    message.includes('ResourceNotFound.NoDataOfRecord')
  );
}

async function describeRecordList(
  client: DnsClient,
  params: {
    Domain: string;
    Subdomain: string;
    RecordType: string;
  },
) {
  try {
    return await client.DescribeRecordList({
      ...params,
      ErrorOnEmpty: 'no',
    });
  } catch (error) {
    if (isEmptyRecordListError(error)) {
      return { RecordList: [] };
    }
    throw error;
  }
}

async function findCnameRecord(
  client: DnsClient,
  domain: string,
  subdomain: string,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await describeRecordList(client, {
      Domain: domain,
      Subdomain: subdomain,
      RecordType: 'CNAME',
    });

    const record = result.RecordList?.find((r) => r.Type === 'CNAME');
    if (record) return record;

    if (attempt < 2) await sleep(3000);
  }

  return undefined;
}

export interface TxtRecordSetupOptions {
  host: string;
  value: string;
  config: GlobalConfig;
}

async function findTxtRecord(client: DnsClient, domain: string, host: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await describeRecordList(client, {
      Domain: domain,
      Subdomain: host,
      RecordType: 'TXT',
    });

    const record = result.RecordList?.find((r) => r.Type === 'TXT');
    if (record) return record;

    if (attempt < 2) await sleep(3000);
  }

  return undefined;
}

export async function ensureTxtRecord(options: TxtRecordSetupOptions): Promise<DnsSetupResult> {
  const { host, value, config } = options;
  const client = createDnsClient(config);
  const domain = config.dns.domain;
  const normalizedValue = value.replace(/^"|"$/g, '');

  const existing = await findTxtRecord(client, domain, host);

  if (existing?.Value && existing.Value.replace(/^"|"$/g, '') === normalizedValue) {
    return { action: 'skipped', recordId: existing.RecordId };
  }

  if (existing?.RecordId != null) {
    await retry(() =>
      client.ModifyRecord({
        Domain: domain,
        RecordId: existing.RecordId!,
        SubDomain: host,
        RecordType: 'TXT',
        RecordLine: config.dns.recordLine,
        Value: normalizedValue,
        TTL: config.dns.ttl,
      }),
    );
    return { action: 'updated', recordId: existing.RecordId };
  }

  const result = await retry(() =>
    client.CreateRecord({
      Domain: domain,
      SubDomain: host,
      RecordType: 'TXT',
      RecordLine: config.dns.recordLine,
      Value: normalizedValue,
      TTL: config.dns.ttl,
    }),
  );

  return { action: 'created', recordId: result.RecordId };
}

export async function ensureCnameRecord(options: DnsSetupOptions): Promise<DnsSetupResult> {
  const { subdomain, cnameTarget, config } = options;
  const client = createDnsClient(config);
  const domain = config.dns.domain;
  const normalizedTarget = normalizeCname(cnameTarget);

  const existing = await findCnameRecord(client, domain, subdomain);

  if (existing?.Value && normalizeCname(existing.Value) === normalizedTarget) {
    return { action: 'skipped', recordId: existing.RecordId };
  }

  if (existing?.RecordId != null) {
    await retry(() =>
      client.ModifyRecord({
        Domain: domain,
        RecordId: existing.RecordId!,
        SubDomain: subdomain,
        RecordType: 'CNAME',
        RecordLine: config.dns.recordLine,
        Value: cnameTarget,
        TTL: config.dns.ttl,
      }),
    );
    return { action: 'updated', recordId: existing.RecordId };
  }

  const result = await retry(() =>
    client.CreateRecord({
      Domain: domain,
      SubDomain: subdomain,
      RecordType: 'CNAME',
      RecordLine: config.dns.recordLine,
      Value: cnameTarget,
      TTL: config.dns.ttl,
    }),
  );

  return { action: 'created', recordId: result.RecordId };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
