import { describe, it, expect } from 'vitest';
import {
  validateDomain,
  normalizeDomain,
  parseFullDomain,
  buildCosPrefixFromKey,
  resolveSubdomainTarget,
  buildVerifyRecordFqdn,
  getRootDomain,
  expandCdnDomains,
  resolveDeployPlan,
} from './domain.js';

describe('validateDomain', () => {
  it('accepts valid domains', () => {
    expect(validateDomain('app.example.com')).toBe(true);
    expect(validateDomain('app.staging.example.com')).toBe(true);
  });

  it('rejects invalid domains', () => {
    expect(validateDomain('')).toBe('域名不能为空');
    expect(validateDomain('https://app.example.com')).not.toBe(true);
    expect(validateDomain('app.example.com/path')).not.toBe(true);
    expect(validateDomain('localhost')).not.toBe(true);
  });
});

describe('parseFullDomain', () => {
  it('parses subdomain under base domain', () => {
    expect(parseFullDomain('my-app.example.com', 'example.com')).toEqual({
      fullDomain: 'my-app.example.com',
      dnsHost: 'my-app',
      cosKey: 'my-app',
      managedDns: true,
    });
  });

  it('parses apex domain', () => {
    expect(parseFullDomain('example.com', 'example.com')).toEqual({
      fullDomain: 'example.com',
      dnsHost: '@',
      cosKey: 'example-com',
      managedDns: true,
    });
  });

  it('parses nested subdomain', () => {
    expect(parseFullDomain('app.staging.example.com', 'example.com')).toEqual({
      fullDomain: 'app.staging.example.com',
      dnsHost: 'app.staging',
      cosKey: 'app-staging',
      managedDns: true,
    });
  });

  it('marks external domain as unmanaged dns', () => {
    const target = parseFullDomain('app.other.com', 'example.com');
    expect(target.fullDomain).toBe('app.other.com');
    expect(target.managedDns).toBe(false);
  });
});

describe('resolveSubdomainTarget', () => {
  it('builds target from subdomain', () => {
    expect(resolveSubdomainTarget('my-app', 'example.com')).toEqual({
      fullDomain: 'my-app.example.com',
      dnsHost: 'my-app',
      cosKey: 'my-app',
      managedDns: true,
    });
  });
});

describe('buildCosPrefixFromKey', () => {
  it('builds cos prefix with trailing slash', () => {
    expect(buildCosPrefixFromKey('sites', 'my-app')).toBe('sites/my-app/');
  });
});

describe('expandCdnDomains', () => {
  it('expands apex domain to apex and www', () => {
    expect(expandCdnDomains('hbshibo.com')).toEqual(['hbshibo.com', 'www.hbshibo.com']);
  });

  it('keeps non-apex domain unchanged', () => {
    expect(expandCdnDomains('www.hbshibo.com')).toEqual(['www.hbshibo.com']);
    expect(expandCdnDomains('app.example.com')).toEqual(['app.example.com']);
  });
});

describe('resolveDeployPlan', () => {
  it('creates shared cos prefix for apex input', () => {
    const plan = resolveDeployPlan('hbshibo.com', 'aigo1.cloud', 'sites');
    expect(plan.cosPrefix).toBe('sites/hbshibo-com/');
    expect(plan.domains.map((entry) => entry.fullDomain)).toEqual([
      'hbshibo.com',
      'www.hbshibo.com',
    ]);
  });
});

describe('buildVerifyRecordFqdn', () => {
  it('uses root domain for www subdomain', () => {
    expect(buildVerifyRecordFqdn('www.hbshibo.com')).toBe('_cdnauth.hbshibo.com');
  });

  it('uses root domain for apex domain', () => {
    expect(buildVerifyRecordFqdn('hbshibo.com')).toBe('_cdnauth.hbshibo.com');
  });

  it('uses root domain for nested subdomain', () => {
    expect(buildVerifyRecordFqdn('app.staging.example.com')).toBe('_cdnauth.example.com');
  });
});

describe('getRootDomain', () => {
  it('extracts root domain', () => {
    expect(getRootDomain('www.hbshibo.com')).toBe('hbshibo.com');
    expect(getRootDomain('hbshibo.com')).toBe('hbshibo.com');
  });
});
