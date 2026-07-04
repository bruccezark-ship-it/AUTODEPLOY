# AutoDeploy 开发文档

> Vite 项目一键构建并发布至腾讯云 COS，自动配置 CDN 与域名解析  
> 技术栈：Node.js

---

## 1. 项目概述

### 1.1 背景

团队内存在大量 Vite 静态站点，每次发布需要手动执行构建、上传 COS、配置 CDN 加速、添加 DNS 解析，流程重复且易出错。AutoDeploy 提供统一的 CLI 工具，在任意 Vite 项目根目录执行 `deploy` 命令，输入子域名即可完成全流程自动化发布。

### 1.2 目标

| 目标 | 说明 |
|------|------|
| 零侵入 | 不修改 Vite 项目业务代码，通过 npm 全局/本地安装 CLI 即可使用 |
| 一键发布 | `deploy` → 输入子域名 → 确认 → 自动完成构建与云端配置 |
| 多项目复用 | 同一套 COS 存储桶，按子域名隔离目录 |
| 自动化基础设施 | 自动创建/更新 CDN 加速域名、DNS CNAME 解析 |
| 可观测 | 清晰的步骤日志、失败回滚提示、发布结果 URL |

### 1.3 非目标（V1 范围外）

- 不支持非 Vite 项目（Webpack、Next.js 等）
- 不支持多环境（dev/staging/prod）复杂策略，仅支持单套腾讯云账号配置
- 不支持 HTTPS 证书自动申请（可预留接口，V1 使用 CDN 已有证书或 HTTP）
- 不支持私有桶 + 鉴权访问（V1 默认公共读静态站点）

---

## 2. 用户交互流程

```
┌─────────────────────────────────────────────────────────────────┐
│  用户在 Vite 项目根目录执行:  deploy                               │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. 检测当前目录是否为 Vite 项目 (package.json + vite 依赖)        │
│  2. 读取 ~/.autodeploy/config.json 或项目内 .autodeployrc         │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. 交互式输入子域名，如: my-app                                   │
│     完整域名预览: my-app.example.com                              │
│     COS 路径预览: sites/my-app/                                   │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. 确认发布摘要 (y/N)                                            │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. 执行 vite build                                               │
│  6. 增量上传 dist/ → COS sites/{subdomain}/                       │
│  7. 确保 CDN 加速域名存在并指向 COS 源站                            │
│  8. 确保 DNSPod CNAME 记录指向 CDN                                │
│  9. 输出访问 URL: https://my-app.example.com                      │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 CLI 命令设计

```bash
# 主命令 — 交互式发布
deploy

# 子命令（可选，V1.1）
deploy init          # 初始化项目 .autodeployrc
deploy config        # 编辑全局/项目配置
deploy status        # 查看当前子域名 CDN/DNS 状态
deploy --subdomain my-app --yes   # 非交互模式（CI 用）
```

### 2.2 交互示例

```
$ deploy

✔ 检测到 Vite 项目: my-vite-app@1.0.0
✔ 构建输出目录: dist

? 请输入子域名 (不含主域名): my-app
  完整访问地址: https://my-app.example.com
  COS 上传路径: sites/my-app/

? 确认发布? (Y/n) Y

⠋ [1/4] 构建项目...
✔ 构建完成 (3.2s, 42 files)

⠋ [2/4] 上传至 COS...
✔ 上传完成 (128 files, 2.1 MB)

⠋ [3/4] 配置 CDN...
✔ CDN 域名已就绪: my-app.example.com

⠋ [4/4] 配置 DNS 解析...
✔ CNAME my-app → my-app.example.com.cdn.dnsv1.com

🎉 发布成功!
   访问地址: https://my-app.example.com
   COS 路径: cos://bucket-1250000000/sites/my-app/
```

---

## 3. 技术架构

### 3.1 整体架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                         Vite 项目目录                             │
│  package.json  vite.config.*  dist/ (构建产物)                   │
└────────────────────────────┬─────────────────────────────────────┘
                             │ deploy CLI
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    @autodeploy/cli (Node.js)                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │  Config  │ │  Builder │ │ Uploader │ │   CDN    │ │   DNS   │ │
│  │  Manager │ │ (vite)   │ │  (COS)   │ │ Manager  │ │ Manager │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └─────────┘ │
└────────────────────────────┬─────────────────────────────────────┘
                             │ Tencent Cloud APIs
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
   ┌───────────┐       ┌───────────┐       ┌───────────┐
   │    COS    │       │    CDN    │       │  DNSPod   │
   │  对象存储  │◄──────│  内容分发  │       │  域名解析  │
   └───────────┘ 回源  └───────────┘       └───────────┘
```

### 3.2 模块职责

| 模块 | 职责 |
|------|------|
| **CLI Entry** | 参数解析、交互式 Prompt、步骤编排、错误处理 |
| **Config Manager** | 加载/校验全局与项目配置，合并默认值 |
| **Project Detector** | 识别 Vite 项目，读取 `outDir`（默认 `dist`） |
| **Builder** | 调用 `vite build`，捕获构建输出 |
| **COS Uploader** | 增量上传、设置 Content-Type、删除过期文件 |
| **CDN Manager** | 创建/更新加速域名，配置 COS 回源 |
| **DNS Manager** | 创建/更新 CNAME 记录指向 CDN |
| **State Store** | 记录每次发布的 subdomain、hash、时间（可选） |

### 3.3 技术选型

| 类别 | 选型 | 理由 |
|------|------|------|
| 运行时 | Node.js ≥ 18 | LTS，原生 fetch、ESM 支持 |
| 语言 | TypeScript | 类型安全，SDK 类型定义完善 |
| CLI 框架 | `commander` + `@inquirer/prompts` | 轻量、交互体验好 |
| 进度展示 | `ora` + `chalk` | 终端友好 |
| COS SDK | `cos-nodejs-sdk-v5` | 官方维护，支持分片上传 |
| 云 API | `tencentcloud-sdk-nodejs` | CDN、DNSPod 统一 SDK |
| 构建 | 子进程执行 `vite build` | 使用项目本地 vite 版本，避免版本冲突 |
| 配置 | `cosmiconfig` | 支持多格式配置文件 |
| 包管理 | `pnpm` workspace（monorepo） | 便于拆分 packages |

---

## 4. 腾讯云资源设计

### 4.1 资源拓扑

```
主域名: example.com (DNSPod 托管)

子域名: {subdomain}.example.com
    │
    ├── DNSPod CNAME → CDN 加速域名
    │
    └── CDN 加速域名
            │
            └── 回源 → COS 存储桶
                        └── sites/{subdomain}/
                              ├── index.html
                              ├── assets/
                              └── ...
```

### 4.2 COS 存储桶规划

| 配置项 | 建议值 | 说明 |
|--------|--------|------|
| 存储桶名称 | `static-sites-{appid}` | 全局唯一 |
| 地域 | `ap-guangzhou` 等 | 与 CDN 回源地域一致 |
| 访问权限 | 公有读私有写 | 静态站点公开访问 |
| 目录规范 | `sites/{subdomain}/` | 每个子站点独立前缀 |
| 静态网站 | 开启 | Index: `index.html`，Error: `index.html`（SPA 路由） |

> **注意**：2024 年后新建的 COS 存储桶不支持通过默认域名直接预览，必须绑定自定义域名访问。因此 CDN + 自定义域名是必选路径，而非可选优化。

### 4.3 CDN 配置模板

| 配置项 | 值 |
|--------|-----|
| 加速域名 | `{subdomain}.example.com` |
| 加速区域 | 中国境内（或全球，按需求） |
| 源站类型 | COS 源 / 源站域名 |
| 回源 Host | COS 源站域名或自定义回源 Host |
| 默认缓存 | HTML: 不缓存或短缓存；JS/CSS/图片: 长期缓存 |
| HTTPS | 使用 CDN 已绑定的 wildcard 证书 `*.example.com` |
| SPA 支持 | 404 → `/index.html`（通过 CDN 错误页或 COS 静态网站配置） |

### 4.4 DNS 解析

| 记录类型 | 主机记录 | 记录值 |
|----------|----------|--------|
| CNAME | `{subdomain}` | CDN 分配的 CNAME（如 `xxx.cdn.dnsv1.com`） |

---

## 5. 核心模块详细设计

### 5.1 配置管理

#### 5.1.1 全局配置 `~/.autodeploy/config.json`

```json
{
  "tencent": {
    "secretId": "AKIDxxxx",
    "secretKey": "xxxx",
    "region": "ap-guangzhou"
  },
  "cos": {
    "bucket": "static-sites-1250000000",
    "prefix": "sites"
  },
  "cdn": {
    "serviceType": "web",
    "area": "mainland",
    "https": true,
    "defaultCacheRules": [
      { "type": "file", "rule": "html", "ttl": 0 },
      { "type": "file", "rule": "js,css", "ttl": 2592000 },
      { "type": "file", "rule": "jpg,png,svg,webp,ico", "ttl": 2592000 }
    ]
  },
  "dns": {
    "domain": "example.com",
    "recordLine": "默认",
    "ttl": 600
  },
  "domain": {
    "baseDomain": "example.com",
    "protocol": "https"
  }
}
```

#### 5.1.2 项目配置 `.autodeployrc`（可选）

```json
{
  "subdomain": "my-app",
  "buildCommand": "vite build",
  "outputDir": "dist",
  "basePath": "/"
}
```

#### 5.1.3 配置优先级

```
CLI 参数 > 环境变量 > 项目 .autodeployrc > 全局 config.json > 默认值
```

#### 5.1.4 环境变量

```bash
TENCENT_SECRET_ID=AKIDxxxx
TENCENT_SECRET_KEY=xxxx
AUTODEPLOY_COS_BUCKET=static-sites-1250000000
AUTODEPLOY_BASE_DOMAIN=example.com
```

---

### 5.2 项目检测 (Project Detector)

**检测逻辑：**

1. 当前目录存在 `package.json`
2. `dependencies` 或 `devDependencies` 包含 `vite`
3. 可选：存在 `vite.config.ts/js/mjs`

**读取构建输出目录：**

```typescript
// 优先级: .autodeployrc.outputDir > vite.config outDir > 'dist'
async function resolveOutDir(projectRoot: string): Promise<string>
```

**Vite base 路径处理：**

若项目 `base: '/subpath/'`，上传 COS 时需保持路径结构，或在构建前注入 `base` 环境变量。

---

### 5.3 构建模块 (Builder)

```typescript
interface BuildOptions {
  cwd: string;
  command: string;      // 默认 'vite build'
  env?: Record<string, string>;
}

interface BuildResult {
  outDir: string;
  duration: number;
  fileCount: number;
}

async function build(options: BuildOptions): Promise<BuildResult>
```

**实现要点：**

- 使用 `execa` 执行构建命令，继承 stdio 或静默模式
- 构建前设置 `NODE_ENV=production`
- 构建失败立即终止，不执行上传
- 统计 `outDir` 下文件数量与总大小

---

### 5.4 COS 上传模块 (Uploader)

```typescript
interface UploadOptions {
  localDir: string;
  remotePrefix: string;   // sites/my-app/
  bucket: string;
  region: string;
}

interface UploadResult {
  uploaded: number;
  deleted: number;
  totalBytes: number;
}

async function uploadDirectory(options: UploadOptions): Promise<UploadResult>
```

**上传策略：**

| 策略 | 说明 |
|------|------|
| 增量上传 | 对比本地 MD5 与 COS ETag，跳过未变更文件 |
| 并发控制 | 默认 10 并发，大文件自动分片 |
| Content-Type | 按扩展名映射（`.js` → `application/javascript`） |
| Cache-Control | HTML: `no-cache`；带 hash 资源: `max-age=31536000, immutable` |
| 清理策略 | 上传完成后删除 COS 上该 prefix 下本地已不存在的文件（可选 `--no-clean`） |

**COS SDK 关键调用：**

```typescript
import COS from 'cos-nodejs-sdk-v5';

const cos = new COS({
  SecretId: config.tencent.secretId,
  SecretKey: config.tencent.secretKey,
});

// 上传单文件
await cos.putObject({
  Bucket: bucket,
  Region: region,
  Key: `${prefix}${relativePath}`,
  Body: fileContent,
  ContentType: mimeType,
  CacheControl: cacheControl,
});

// 列出已有对象（用于增量对比和清理）
await cos.getBucket({
  Bucket: bucket,
  Region: region,
  Prefix: prefix,
});
```

**SPA 路由支持：**

首次部署某 subdomain 时，确保 COS 存储桶已开启静态网站配置：

```typescript
await cos.putBucketWebsite({
  Bucket: bucket,
  Region: region,
  WebsiteConfiguration: {
    IndexDocument: { Suffix: 'index.html' },
    ErrorDocument: { Key: 'index.html' },  // SPA fallback
  },
});
```

---

### 5.5 CDN 管理模块 (CDN Manager)

```typescript
interface CdnSetupOptions {
  domain: string;           // my-app.example.com
  cosOrigin: {
    bucket: string;
    region: string;
    path: string;           // /sites/my-app/
  };
}

async function ensureCdnDomain(options: CdnSetupOptions): Promise<{ cname: string }>
```

**流程：**

```
1. DescribeDomainsConfig / DescribeDomains
   └─ 域名已存在? → 检查源站配置是否正确 → 必要时 UpdateDomainConfig
   └─ 不存在? → AddCdnDomain 创建

2. 等待 CDN 部署生效（轮询或固定等待 30s）

3. 返回 CDN CNAME 地址
```

**AddCdnDomain 关键参数：**

```typescript
import { cdn } from 'tencentcloud-sdk-nodejs';

const client = new cdn.v20180606.Client({ credential, region: '' });

// 新增加速域名
await client.AddCdnDomain({
  Domain: 'my-app.example.com',
  ServiceType: 'web',
  Origin: {
    Origins: [`${bucket}.cos.${region}.myqcloud.com`],
    OriginType: 'cos',
    ServerName: `${bucket}.cos.${region}.myqcloud.com`,
    CosPrivateAccess: 'off',
    OriginPullProtocol: 'https',
  },
  Area: 'mainland',
});

// 配置回源路径（指向特定 COS 目录）
await client.UpdateDomainConfig({
  Domain: 'my-app.example.com',
  Origin: {
    Origins: [`${bucket}.cos.${region}.myqcloud.com`],
    OriginType: 'cos',
    OriginPullPath: '/sites/my-app',  // 回源路径前缀
  },
});
```

**缓存规则：**

```typescript
await client.UpdateDomainConfig({
  Domain: domain,
  Cache: {
    Rule: [
      { CacheType: 'file', CacheContents: 'html', CacheTime: 0 },
      { CacheType: 'file', CacheContents: 'js,css', CacheTime: 2592000 },
    ],
  },
});
```

**HTTPS 配置（若已有泛域名证书）：**

```typescript
await client.UpdateDomainConfig({
  Domain: domain,
  Https: {
    Switch: 'on',
    CertInfo: { CertId: 'cert-xxxxx' },  // 或在配置中指定
  },
});
```

---

### 5.6 DNS 管理模块 (DNS Manager)

```typescript
interface DnsSetupOptions {
  subdomain: string;        // my-app
  baseDomain: string;       // example.com
  cnameTarget: string;      // xxx.cdn.dnsv1.com
}

async function ensureCnameRecord(options: DnsSetupOptions): Promise<void>
```

**流程：**

```
1. DescribeRecordList 查询 {subdomain}.example.com 的 CNAME 记录
   └─ 记录存在且 Value 正确 → 跳过
   └─ 记录存在但 Value 不同 → ModifyRecord 更新
   └─ 记录不存在 → CreateRecord 创建
```

**DNSPod SDK 调用：**

```typescript
import { dnspod } from 'tencentcloud-sdk-nodejs';

const client = new dnspod.v20210323.Client({ credential, region: '' });

// 查询记录
const records = await client.DescribeRecordList({
  Domain: 'example.com',
  Subdomain: 'my-app',
  RecordType: 'CNAME',
});

// 创建 CNAME
await client.CreateRecord({
  Domain: 'example.com',
  SubDomain: 'my-app',
  RecordType: 'CNAME',
  RecordLine: '默认',
  Value: cnameTarget,
  TTL: 600,
});

// 更新已有记录
await client.ModifyRecord({
  Domain: 'example.com',
  RecordId: existingRecordId,
  SubDomain: 'my-app',
  RecordType: 'CNAME',
  RecordLine: '默认',
  Value: cnameTarget,
  TTL: 600,
});
```

> 新创建的 DNS 记录可能存在约 30 秒索引延迟，查询不到时应重试。

---

### 5.7 发布编排 (Deploy Orchestrator)

```typescript
interface DeployContext {
  projectRoot: string;
  subdomain: string;
  fullDomain: string;
  cosPrefix: string;
  config: DeployConfig;
}

async function deploy(ctx: DeployContext): Promise<DeployResult> {
  const steps = [
    { name: '构建项目', fn: () => buildProject(ctx) },
    { name: '上传 COS', fn: () => uploadToCos(ctx) },
    { name: '配置 CDN', fn: () => setupCdn(ctx) },
    { name: '配置 DNS', fn: () => setupDns(ctx) },
  ];

  for (const step of steps) {
    await runStep(step);
  }

  return {
    url: `https://${ctx.fullDomain}`,
    cosPath: `cos://${ctx.config.cos.bucket}/${ctx.cosPrefix}`,
  };
}
```

**幂等性设计：**

每个步骤均设计为「确保达到期望状态」，重复执行不会产生副作用：

- COS：增量上传，已存在且 hash 相同则跳过
- CDN：域名存在则更新配置，不存在则创建
- DNS：记录存在则更新，不存在则创建

---

## 6. 项目结构

```
AutoDeploy/
├── packages/
│   ├── cli/                      # CLI 入口包，发布为 npm @autodeploy/cli
│   │   ├── bin/
│   │   │   └── deploy.js         # shebang 入口
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── commands/
│   │   │   │   ├── deploy.ts
│   │   │   │   ├── init.ts
│   │   │   │   └── config.ts
│   │   │   └── prompts/
│   │   │       └── subdomain.ts
│   │   └── package.json
│   │
│   └── core/                     # 核心逻辑包
│       ├── src/
│       │   ├── config/
│       │   │   ├── loader.ts
│       │   │   └── schema.ts
│       │   ├── detector/
│       │   │   └── vite-project.ts
│       │   ├── builder/
│       │   │   └── vite-builder.ts
│       │   ├── uploader/
│       │   │   ├── cos-uploader.ts
│       │   │   └── mime.ts
│       │   ├── cdn/
│       │   │   └── cdn-manager.ts
│       │   ├── dns/
│       │   │   └── dns-manager.ts
│       │   ├── orchestrator/
│       │   │   └── deploy.ts
│       │   └── utils/
│       │       ├── logger.ts
│       │       └── retry.ts
│       └── package.json
│
├── docs/
│   └── DEVELOPMENT.md            # 本文档
├── scripts/
│   └── setup-bucket.ts           # 一次性 COS 存储桶初始化脚本
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## 7. 安装与使用

### 7.1 工具安装

```bash
# 全局安装 CLI
npm install -g @autodeploy/cli

# 或项目内安装
npm install -D @autodeploy/cli
# package.json scripts: { "deploy": "deploy" }
```

### 7.2 首次配置

```bash
# 交互式配置腾讯云凭证与域名
deploy config

# 或手动创建 ~/.autodeploy/config.json
```

### 7.3 在 Vite 项目中使用

```bash
cd my-vite-project
deploy
# 输入子域名 → 确认 → 等待完成
```

### 7.4 在 package.json 中添加脚本（推荐）

```json
{
  "scripts": {
    "deploy": "deploy"
  }
}
```

---

## 8. 权限与密钥

### 8.1 腾讯云 CAM 策略

为 AutoDeploy 创建专用子账号，授予最小权限：

```json
{
  "version": "2.0",
  "statement": [
    {
      "effect": "allow",
      "action": [
        "cos:PutObject",
        "cos:GetObject",
        "cos:DeleteObject",
        "cos:GetBucket",
        "cos:ListBucket",
        "cos:PutBucketWebsite",
        "cos:GetBucketWebsite"
      ],
      "resource": [
        "qcs::cos:ap-guangzhou:uid/1250000000:static-sites-1250000000/*",
        "qcs::cos:ap-guangzhou:uid/1250000000:static-sites-1250000000"
      ]
    },
    {
      "effect": "allow",
      "action": [
        "cdn:AddCdnDomain",
        "cdn:UpdateDomainConfig",
        "cdn:DescribeDomains",
        "cdn:DescribeDomainsConfig",
        "cdn:PurgeUrlsCache"
      ],
      "resource": ["*"]
    },
    {
      "effect": "allow",
      "action": [
        "dnspod:CreateRecord",
        "dnspod:ModifyRecord",
        "dnspod:DescribeRecordList",
        "dnspod:DeleteRecord"
      ],
      "resource": ["*"]
    }
  ]
}
```

### 8.2 密钥安全

| 规则 | 说明 |
|------|------|
| 禁止硬编码 | 密钥只存 `~/.autodeploy/config.json` 或环境变量 |
| 文件权限 | `config.json` 设为 `600`（仅所有者可读写） |
| 不入库 | `.gitignore` 排除 `.autodeployrc` 中的敏感字段 |
| CI 场景 | 使用环境变量注入，不写配置文件 |

---

## 9. 错误处理

### 9.1 错误分类

| 类型 | 示例 | 处理 |
|------|------|------|
| 配置错误 | 缺少 secretId | 提示运行 `deploy config` |
| 项目错误 | 非 Vite 项目 | 退出并说明检测条件 |
| 构建错误 | vite build 失败 | 展示构建日志，终止后续步骤 |
| 上传错误 | COS 网络超时 | 自动重试 3 次，指数退避 |
| 云 API 错误 | CDN 域名已被其他账号占用 | 明确错误信息，建议人工处理 |
| DNS 错误 | 域名不在 DNSPod | 提示迁移 DNS 或手动添加 CNAME |

### 9.2 重试策略

```typescript
const retryConfig = {
  maxAttempts: 3,
  baseDelay: 1000,
  retryableErrors: [
    'NetworkError',
    'RequestTimeout',
    'InternalError',
  ],
};
```

### 9.3 子域名校验

```typescript
const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function validateSubdomain(input: string): string | true {
  if (!SUBDOMAIN_REGEX.test(input)) {
    return '子域名只能包含小写字母、数字和连字符，且不能以连字符开头或结尾';
  }
  if (RESERVED_NAMES.includes(input)) {
    return `"${input}" 是保留名称，不可使用`;
  }
  return true;
}

const RESERVED_NAMES = ['www', 'api', 'cdn', 'admin', 'mail', 'ftp'];
```

---

## 10. 缓存与刷新策略

### 10.1 上传时设置 Cache-Control

| 文件类型 | Cache-Control |
|----------|---------------|
| `index.html` | `no-cache, no-store, must-revalidate` |
| `*.js`, `*.css`（含 content hash） | `public, max-age=31536000, immutable` |
| 图片/字体 | `public, max-age=2592000` |

### 10.2 发布后 CDN 刷新

HTML 文件上传后，主动刷新 CDN 缓存以确保用户获取最新入口：

```typescript
await cdnClient.PurgeUrlsCache({
  Urls: [`https://${fullDomain}/`, `https://${fullDomain}/index.html`],
});
```

---

## 11. 开发计划

### Phase 1 — MVP（2 周）

- [ ] Monorepo 脚手架与 TypeScript 配置
- [ ] 配置加载与校验（zod schema）
- [ ] Vite 项目检测
- [ ] 构建 + COS 上传
- [ ] 基础 CLI 交互（子域名输入 + 确认）
- [ ] 单元测试：配置解析、子域名校验

### Phase 2 — 云端自动化（1.5 周）

- [ ] CDN 域名自动创建/更新
- [ ] DNSPod CNAME 自动配置
- [ ] 完整发布编排与步骤日志
- [ ] 错误处理与重试

### Phase 3 — 体验优化（1 周）

- [ ] `deploy init` / `deploy config` 子命令
- [ ] 增量上传优化（MD5 对比）
- [ ] CDN 缓存刷新
- [ ] `--yes` 非交互模式（CI 支持）
- [ ] 发布完成后输出 QR 码（可选）

### Phase 4 — 生产就绪（1 周）

- [ ] 集成测试（使用测试 COS 桶）
- [ ] npm 发布 `@autodeploy/cli`
- [ ] 使用文档与 README
- [ ] COS 存储桶一次性初始化脚本

---

## 12. 测试策略

### 12.1 单元测试

| 模块 | 测试点 |
|------|--------|
| config/loader | 配置合并优先级、schema 校验 |
| detector | Vite 项目识别、outDir 解析 |
| validate | 子域名格式、保留名 |
| mime | 扩展名 → Content-Type 映射 |

### 12.2 集成测试

- 使用 `.env.test` 中的测试账号与测试存储桶
- Mock 腾讯云 SDK 响应，验证编排逻辑
- 端到端测试：示例 Vite 项目完整 deploy 流程

### 12.3 手动测试清单

- [ ] 首次发布新子域名（CDN + DNS 均不存在）
- [ ] 重复发布同一子域名（幂等性）
- [ ] 修改代码后再次发布（增量上传）
- [ ] 非 Vite 目录执行 deploy（应报错）
- [ ] 无效子域名输入（应拒绝）
- [ ] 构建失败场景（不应上传）
- [ ] SPA 路由刷新（如 `/about` 直接访问）

---

## 13. 依赖清单

```json
{
  "dependencies": {
    "@inquirer/prompts": "^7.0.0",
    "chalk": "^5.3.0",
    "commander": "^12.0.0",
    "cos-nodejs-sdk-v5": "^2.14.0",
    "cosmiconfig": "^9.0.0",
    "execa": "^9.0.0",
    "fast-glob": "^3.3.0",
    "mime-types": "^2.1.35",
    "ora": "^8.0.0",
    "tencentcloud-sdk-nodejs": "^4.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

---

## 14. 参考文档

| 资源 | 链接 |
|------|------|
| COS Node.js SDK | https://cloud.tencent.com/document/product/436/8629 |
| COS 静态网站配置 | https://cloud.tencent.com/document/product/436/43607 |
| COS 自定义域名 | https://cloud.tencent.com/document/product/436/43813 |
| CDN AddCdnDomain | https://cloud.tencent.com/document/product/228/3938 |
| CDN UpdateDomainConfig | https://cloud.tencent.com/document/product/228/41116 |
| DNSPod CreateRecord | https://cloud.tencent.com/document/product/1427/56180 |
| Vite 构建配置 | https://vite.dev/config/build-options.html |

---

## 15. 附录

### A. 一次性 COS 存储桶初始化

首次使用前，需手动或通过 `scripts/setup-bucket.ts` 完成：

1. 创建存储桶（公有读私有写）
2. 开启静态网站（Index: `index.html`，Error: `index.html`）
3. 在 CDN 控制台上传/绑定 `*.example.com` 泛域名 HTTPS 证书

### B. Vite 项目 base 路径

若项目部署在子路径（`base: '/app/'`），有两种策略：

1. **推荐**：每个 subdomain 对应独立站点，`base: '/'`
2. **共用域名子路径**：不在 V1 范围，需额外路由配置

### C. 子域名命名规范

```
✅ my-app, blog, docs-v2, team-alpha
❌ My-App (大写), -start (连字符开头), www (保留)
```

---

*文档版本: v1.0 | 最后更新: 2026-07-03*
