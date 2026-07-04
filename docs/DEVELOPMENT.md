# AutoDeploy 开发文档

> Vite 项目一键构建并发布至腾讯云 COS，自动配置 CDN 与域名解析  
> 技术栈：Node.js + TypeScript + pnpm workspace

---

## 1. 项目概述

### 1.1 背景

团队内存在大量 Vite 静态站点，每次发布需要手动执行构建、上传 COS、配置 CDN 加速、添加 DNS 解析，流程重复且易出错。AutoDeploy 提供统一的 CLI 工具，在 Vite 项目根目录执行 `deploy`，通过子域名或完整域名完成全流程自动化发布；亦可通过 `deploy -delete` 一键下线。

### 1.2 目标

| 目标 | 说明 |
|------|------|
| 零侵入 | 不修改 Vite 项目业务代码，全局/本地安装 CLI 即可使用 |
| 一键发布 | 交互式选择域名、协议、CDN HTTPS → 自动构建与云端配置 |
| 多项目复用 | 同一 COS 存储桶，按站点隔离目录前缀 |
| 自动化基础设施 | CDN（COS 源站）、DNSPod CNAME、域名归属验证 |
| 可下线 | `-delete` 删除 CDN、DNS 解析与 COS 资源 |
| 可观测 | 分步日志、失败提示、多域名结果输出 |

### 1.3 已实现能力（当前版本）

- 子域名 / 完整域名两种发布方式
- 根域名输入时自动部署 `example.com` + `www.example.com`（共用 COS）
- 交互式选择访问协议（HTTP/HTTPS，默认 HTTP）与 CDN HTTPS（默认关闭）
- 外部域名 CDN 归属 TXT 验证（交互式指引 + DNS 预检）
- CDN 源站：`OriginType: cos` + 静态网站域名 + 回源协议跟随
- CDN HTTPS：`HttpsBilling` + 证书配置，关闭时显式 `off`
- 下线：CDN 删除、DNSPod CNAME 删除、COS 前缀清理（共享路径保护）

### 1.4 非目标

- 不支持非 Vite 项目
- 不支持多腾讯云账号/多环境复杂策略
- 不支持 HTTPS 证书自动申请（使用已有 `certId` 或关闭 HTTPS）
- 外部域名 DNS 不自动配置（需手动 CNAME）

---

## 2. 用户交互流程

### 2.1 发布流程（deploy）

```
用户在 Vite 项目根目录执行: deploy
        │
        ▼
检测 Vite 项目 + 加载配置（~/.autodeploy/config.json + .autodeployrc）
        │
        ▼
选择发布方式
  ├─ 子域名 → my-app → my-app.example.com
  └─ 完整域名 → app.example.com / hbshibo.com 等
        │
        ▼
（根域名 hbshibo.com → 自动扩展为 hbshibo.com + www.hbshibo.com）
        │
        ▼
选择访问协议（默认 HTTP）+ 是否开启 CDN HTTPS（默认否）
        │
        ▼
确认发布摘要
        │
        ▼
[1/4] vite build
[2/4] 上传 COS（sites/{key}/）
[3/4] 配置 CDN（每个加速域名；新域名需 TXT 归属验证）
[4/4] 配置 DNS（托管域名自动 CNAME，外部域名跳过并提示）
        │
        ▼
输出访问 URL、COS 路径、CDN CNAME
```

### 2.2 下线流程（deploy -delete）

```
deploy -delete wocao.example.com [-y]
        │
        ▼
[1/3] StopCdnDomain + DeleteCdnDomain
[2/3] DeleteRecord 删除 DNSPod CNAME（非托管域名跳过）
[3/3] 删除 COS 前缀下所有对象（若同前缀仍有其他 CDN 在线则保留）
```

### 2.3 CLI 命令

```bash
# 发布
deploy                              # 交互式
deploy -s my-app                    # 子域名
deploy -d app.example.com           # 完整域名
deploy -s my-app -y                 # 非交互（使用配置文件默认值）
deploy --no-clean                   # 不清理 COS 远程多余文件

# 下线
deploy -delete wocao.example.com
deploy -delete wocao.example.com -y

# 配置
deploy config                       # 全局配置向导
deploy init                         # 项目 .autodeployrc
```

### 2.4 交互示例（完整域名 + 双 CDN）

```
$ deploy

✔ 检测到 Vite 项目: my-vite-app@1.0.0
✔ 构建输出目录: dist

? 选择发布方式 完整域名 (如 app.example.com)
? 请输入完整域名 hbshibo.com
  将同时配置 CDN 加速域名: hbshibo.com 与 www.hbshibo.com
  两个域名指向同一 COS 资源

? 选择访问协议 HTTP
? 是否开启 CDN HTTPS 访问? No

? 确认发布至 http://hbshibo.com, http://www.hbshibo.com? Yes

⠋ [1/4] 构建项目...
✔ 构建完成 (3.2s, 42 files)
...
🎉 发布成功!
   访问地址: http://hbshibo.com
   访问地址: http://www.hbshibo.com
   COS 路径: cos://bucket/sites/hbshibo-com/
```

---

## 3. 技术架构

### 3.1 整体架构

```
Vite 项目 → @autodeploy/cli → @autodeploy/core
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
                  COS             CDN            DNSPod
              (静态网站源)      (加速域名)       (CNAME/TXT)
```

### 3.2 模块职责

| 模块 | 路径 | 职责 |
|------|------|------|
| CLI Entry | `packages/cli` | commander 参数、inquirer 交互、步骤 spinner |
| Config | `core/config` | zod schema、全局/项目配置加载、环境变量 |
| Project Detector | `core/detector` | Vite 项目识别、outDir 解析 |
| Builder | `core/builder` | `vite build` 子进程 |
| COS Uploader | `core/uploader` | 增量上传、deletePrefix |
| CDN Manager | `core/cdn` | 域名创建/更新、HTTPS、归属验证 |
| DNS Manager | `core/dns` | CNAME/TXT 增删改 |
| Deploy Orchestrator | `core/orchestrator/deploy.ts` | 发布四步编排 |
| Undeploy Orchestrator | `core/orchestrator/undeploy.ts` | 下线三步编排 |
| Domain Utils | `core/validate/domain.ts` | 域名校验、DeployPlan、COS 前缀映射 |

### 3.3 技术选型

| 类别 | 选型 |
|------|------|
| 运行时 | Node.js ≥ 18 |
| 语言 | TypeScript |
| CLI | `commander` + `@inquirer/prompts` + `ora` + `chalk` |
| COS | `cos-nodejs-sdk-v5` |
| 云 API | `tencentcloud-sdk-nodejs`（CDN v20180606、DNSPod v20210323） |
| 配置校验 | `zod` |
| 测试 | `vitest` |
| Monorepo | `pnpm` workspace |

---

## 4. 腾讯云资源设计

### 4.1 资源拓扑

```
主域名: example.com (DNSPod 托管，config.dns.domain)

托管子站: {sub}.example.com
    ├── DNSPod CNAME → CDN CNAME
    └── CDN → COS sites/{sub}/

根域名站点: hbshibo.com + www.hbshibo.com
    ├── 两个 CDN 加速域名
    ├── 共用 COS sites/hbshibo-com/
    └── 外部 DNS 时需手动 CNAME

外部域名: www.other.com
    ├── CDN 加速域名（TXT 归属验证）
    ├── COS sites/www-other-com/
    └── DNS 手动配置
```

### 4.2 COS

| 配置项 | 说明 |
|--------|------|
| 目录规范 | `{prefix}/{cosKey}/`，如 `sites/wocao/`、`sites/hbshibo-com/` |
| 静态网站 | Index/Error 均为 `index.html`（`ensureBucketWebsite`） |
| 访问 | 通过 CDN 自定义域名，非 COS 默认域名 |

**cosKey 规则：**

| 输入 | cosKey | cosPrefix |
|------|--------|-----------|
| 子域名 `wocao` | `wocao` | `sites/wocao/` |
| 根域名 `hbshibo.com` | `hbshibo-com` | `sites/hbshibo-com/` |
| 外部 `www.other.com` | `www-other-com` | `sites/www-other-com/` |

### 4.3 CDN 配置（当前实现）

| 配置项 | 值 |
|--------|-----|
| 源站类型 | `OriginType: cos` |
| 源站地址 | `{bucket}.cos-website.{region}.myqcloud.com` |
| 回源路径 | `BasePath: /sites/{key}` |
| 回源协议 | `OriginPullProtocol: follow`（协议跟随） |
| 404 处理 | CDN ErrorPage 302 → `{protocol}://{domain}/index.html` |
| HTTPS 关闭 | `HttpsBilling.Switch: off` + `Https.Switch: off` + `ForceRedirect.Switch: off` |
| HTTPS 开启 | `HttpsBilling.Switch: on` + 证书 `CertId` |
| 加速区域 | `config.cdn.area`（境外 COS 用 `overseas`） |

### 4.4 CDN 域名归属验证

腾讯云要求新加速域名通过 TXT 验证。规则：

- TXT 始终添加在**根域名**解析区域：`_cdnauth.{rootDomain}`
- 主机记录固定为 `_cdnauth`
- `www.hbshibo.com`、`hbshibo.com` 等共用同一 TXT 位置，**验证值按域名不同**，需更新记录值

实现：

1. `CreateVerifyRecord` 获取 Record
2. 托管域名：尝试 DNSPod 自动写入 TXT
3. 失败或外部域名：交互式 `runCdnVerificationFlow`（展示记录、`checkTxtRecord` 预检、`VerifyDomainRecord`）
4. 验证通过后 `AddCdnDomain`

相关代码：`core/cdn/cdn-manager.ts`、`core/cdn/txt-dns-check.ts`、`cli/prompts/cdn-verification.ts`

### 4.5 DNS

| 操作 | API |
|------|-----|
| 发布 CNAME | `CreateRecord` / `ModifyRecord` |
| CDN 验证 TXT | `CreateRecord` / `ModifyRecord` |
| 下线 CNAME | `DeleteRecord` |

`DescribeRecordList` 需传 `ErrorOnEmpty: 'no'`，并处理空列表错误。

---

## 5. 核心模块设计

### 5.1 配置

**全局配置** `~/.autodeploy/config.json`（权限 `600`）

```json
{
  "tencent": { "secretId", "secretKey", "region" },
  "cos": { "bucket", "prefix": "sites" },
  "cdn": {
    "serviceType": "web",
    "area": "overseas",
    "https": false,
    "certId": "可选",
    "defaultCacheRules": [...]
  },
  "dns": { "domain", "recordLine": "默认", "ttl": 600 },
  "domain": { "baseDomain", "protocol": "http" }
}
```

**项目配置** `.autodeployrc`（可选）

```json
{
  "subdomain": "my-app",
  "buildCommand": "vite build",
  "outputDir": "dist",
  "cleanRemote": true
}
```

**优先级：** CLI 参数 > 环境变量 > `.autodeployrc` > 全局 config > 默认值

**环境变量：**

```bash
TENCENT_SECRET_ID / TENCENT_SECRET_KEY / TENCENT_CLOUD_REGION
AUTODEPLOY_COS_BUCKET / AUTODEPLOY_COS_PREFIX / AUTODEPLOY_BASE_DOMAIN
```

### 5.2 域名与发布计划

```typescript
// core/validate/domain.ts

interface DeployPlan {
  cosKey: string;
  cosPrefix: string;           // sites/hbshibo-com/
  domains: DeployDomainEntry[]; // 一个或多个 CDN 域名
  primaryDomain: string;
}

expandCdnDomains('hbshibo.com')
// → ['hbshibo.com', 'www.hbshibo.com']

resolveDeployPlan(input, baseDomain, cosPrefixBase)
resolveCosPrefixFromDomain(domain, baseDomain, cosPrefixBase)  // undeploy 用
parseFullDomain(fullDomain, baseDomain)  // dnsHost + managedDns
```

### 5.3 发布编排

```typescript
interface DeployContext {
  projectRoot: string;
  cosPrefix: string;
  domains: DeployDomainEntry[];
  config: DeployConfig;
  outDir: string;
}

interface DeployOptions {
  noClean?: boolean;
  onCdnVerificationRequired?: CdnVerificationHandler;
  onStepStart / onStepComplete;
}
```

步骤：构建 → 上传（单次）→ 逐域名 CDN → 逐域名 DNS → 按协议刷新 CDN 缓存。

### 5.4 下线编排

```typescript
interface UndeployContext {
  domain: string;
  config: GlobalConfig;
}

// 步骤
removeCdnDomain()      // Stop + Delete
removeCnameRecord()    // 托管域名
deletePrefix()         // 同前缀无其他 CDN 时
```

### 5.5 CDN Manager 关键 API

```typescript
ensureCdnDomain({ domain, cosOriginPath, config, managedDns, onVerificationRequired })
removeCdnDomain(config, domain)
isCdnDomainExists(config, domain)
purgeCdnCache(config, urls)
```

`buildOriginConfig` 使用 cos-website 源站；`applyDomainHttpsConfig` 单独调用 `UpdateDomainConfig` 设置 HTTPS。

### 5.6 DNS Manager 关键 API

```typescript
ensureCnameRecord({ subdomain, cnameTarget, config })
ensureTxtRecord({ host, value, config })
removeCnameRecord({ subdomain, config })
```

### 5.7 COS Uploader 关键 API

```typescript
uploadDirectory({ localDir, remotePrefix, config, clean })
deletePrefix(config, prefix)
ensureBucketWebsite(config)
```

增量对比：本地 MD5 vs COS ETag。

---

## 6. 项目结构

```
AutoDeploy/
├── packages/
│   ├── cli/
│   │   ├── bin/deploy.js
│   │   └── src/
│   │       ├── index.ts              # commander 入口
│   │       ├── commands/
│   │       │   ├── deploy.ts
│   │       │   ├── undeploy.ts
│   │       │   ├── config.ts
│   │       │   └── init.ts
│   │       └── prompts/
│   │           ├── deploy-target.ts
│   │           ├── deploy-settings.ts
│   │           └── cdn-verification.ts
│   └── core/
│       └── src/
│           ├── config/
│           ├── detector/
│           ├── builder/
│           ├── uploader/
│           ├── cdn/
│           │   ├── cdn-manager.ts
│           │   └── txt-dns-check.ts
│           ├── dns/
│           ├── orchestrator/
│           │   ├── deploy.ts
│           │   └── undeploy.ts
│           └── validate/
│               ├── subdomain.ts
│               └── domain.ts
├── docs/
│   ├── DEVELOPMENT.md
│   └── README.md
├── scripts/                          # pnpm setup-bucket 入口在 core
├── pnpm-workspace.yaml
└── package.json
```

---

## 7. 安装与开发

```bash
pnpm install
pnpm build
pnpm test

# 全局安装 CLI
cd packages/cli && pnpm add -g .

# COS 存储桶初始化
pnpm setup-bucket
```

---

## 8. 权限与密钥（CAM）

### 8.1 建议策略 Action

**COS：**

```
PutObject, GetObject, DeleteObject, GetBucket, PutBucketWebsite, GetBucketWebsite
```

> 若账号无 `ListBucket`，`GetBucket` 列举前缀仍可工作（当前实现使用 `getBucket` API）。

**CDN：**

```
AddCdnDomain, UpdateDomainConfig, DescribeDomains, DescribeDomainsConfig
CreateVerifyRecord, VerifyDomainRecord
StopCdnDomain, DeleteCdnDomain
PurgeUrlsCache
```

**DNSPod：**

```
DescribeDomain, DescribeDomainList, DescribeRecordList
CreateRecord, ModifyRecord, DeleteRecord
```

> 账户内域名自动 CDN 归属验证依赖：`DescribeDomain`（检测域名是否在账户下）、`CreateRecord`/`ModifyRecord`（写入 `_cdnauth` TXT）、`CreateVerifyRecord`/`VerifyDomainRecord`（CDN 验证）。

完整 CAM 策略示例见 [docs/cam-policy.example.json](cam-policy.example.json)。

### 8.2 密钥安全

- 仅存 `~/.autodeploy/config.json` 或环境变量
- `saveGlobalConfig` 写入后 `chmod 600`
- CI 使用环境变量，不写配置文件

---

## 9. 错误处理

| 类型 | 处理 |
|------|------|
| ConfigError | 提示 `deploy config` |
| ProjectError | 非 Vite 项目退出 |
| CdnVerificationError | 展示 TXT 记录信息，交互式重试 |
| 备案错误 | 提示 `cdn.area` 改为 `overseas` |
| DNS 空列表 | `ErrorOnEmpty: 'no'` + 捕获空列表错误码 |
| 网络/API | `retry()` 最多 3 次 |

**子域名 / 完整域名校验：** `validate/subdomain.ts`、`validate/domain.ts`

---

## 10. 缓存策略

| 文件 | Cache-Control |
|------|---------------|
| index.html | no-cache |
| js/css（含 hash） | long cache |
| 图片/字体 | long cache |

发布后刷新：

```typescript
purgeCdnCache(config, [
  `${protocol}://${domain}/`,
  `${protocol}://${domain}/index.html`,
]);
```

---

## 11. 测试

```bash
pnpm test   # packages/core vitest
```

| 模块 | 测试文件 |
|------|----------|
| subdomain | `validate/subdomain.test.ts` |
| domain | `validate/domain.test.ts`（expandCdnDomains、resolveDeployPlan、buildVerifyRecordFqdn 等） |
| mime | `uploader/mime.test.ts` |

---

## 12. 依赖

见 `packages/core/package.json`、`packages/cli/package.json`。核心：`zod`、`cos-nodejs-sdk-v5`、`tencentcloud-sdk-nodejs`、`execa`、`fast-glob`、`commander`、`@inquirer/prompts`。

---

## 13. 参考文档

| 资源 | 链接 |
|------|------|
| COS Node.js SDK | https://cloud.tencent.com/document/product/436/8629 |
| CDN UpdateDomainConfig | https://cloud.tencent.com/document/product/228/41116 |
| CDN 域名归属验证 | https://cloud.tencent.com/document/product/228/61702 |
| CDN CreateVerifyRecord | https://cloud.tencent.com/document/product/228/48118 |
| DNSPod CreateRecord | https://cloud.tencent.com/document/product/1427/56180 |
| Vite Build | https://vite.dev/config/build-options.html |

---

## 14. 附录

### A. 根域名双 CDN 与 COS 共享

输入 `example.com` 时 `expandCdnDomains` 返回 apex + www，共用 `sites/example-com/`。下线其中一个时，若另一个 CDN 仍存在，COS 不删除。

### B. CDN HTTPS 关闭要点

仅设置 `Https.Switch: off` 无效，必须同时设置 `HttpsBilling.Switch: off`，否则控制台仍显示 HTTPS 服务开启。

### C. 外部域名 TXT 验证

同一根域名下多个加速域名共用 `_cdnauth.{root}`，验证新域名时需**更新 TXT 记录值**为当前 `CreateVerifyRecord` 返回值。

### D. 子域名命名

```
✅ my-app, blog, docs-v2
❌ My-App, -start, www（保留名，子域名模式）
```

---

*文档版本: v1.1 | 最后更新: 2026-07-04*
