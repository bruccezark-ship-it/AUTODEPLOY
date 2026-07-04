# AutoDeploy

Vite 项目一键发布至腾讯云 COS，自动配置 CDN 与 DNS 解析。

## 功能

- 自动检测 Vite 项目、构建并上传至 COS
- 自动创建/更新 CDN 加速域名（COS 源站、协议跟随回源）
- 自动配置 DNSPod CNAME 解析（托管域名）
- 交互式选择访问协议（HTTP/HTTPS）与 CDN HTTPS 开关
- 支持子域名、完整域名发布；根域名自动同时部署 `example.com` 与 `www.example.com`
- 外部域名 CDN 归属验证（交互式 TXT 记录指引）
- 一键下线：删除 CDN、DNS 解析与 COS 资源

## 快速开始

### 1. 安装

```bash
# 在 monorepo 根目录
pnpm install
pnpm build

# 全局安装 CLI（pnpm 11+）
cd packages/cli
pnpm add -g .

# 若 deploy 命令冲突，可改用：
#   pnpm exec deploy --help
# 或在 Vite 项目中本地安装：pnpm add -D @autodeploy/cli
```

### 2. 配置腾讯云

```bash
deploy config
```

按提示填写 SecretId、SecretKey、COS 存储桶、主域名等信息。

**配置文件位置：**

| 系统 | 路径 |
|------|------|
| Linux / macOS | `~/.autodeploy/config.json` |
| Windows | `C:\Users\<用户名>\.autodeploy\config.json` |

也可通过环境变量覆盖部分配置：

```bash
export TENCENT_SECRET_ID=AKIDxxxx
export TENCENT_SECRET_KEY=xxxx
export TENCENT_CLOUD_REGION=ap-singapore
export AUTODEPLOY_COS_BUCKET=static-sites-1250000000
export AUTODEPLOY_COS_PREFIX=sites
export AUTODEPLOY_BASE_DOMAIN=example.com
```

### 3. 初始化 COS 存储桶（首次）

```bash
pnpm setup-bucket
```

开启静态网站托管（404 → index.html），`deploy` 时也会自动执行。

### 4. 在 Vite 项目中发布

```bash
cd my-vite-project
deploy init          # 可选：创建 .autodeployrc
deploy               # 交互式发布
```

或在 `package.json` 中添加：

```json
{
  "scripts": {
    "deploy": "deploy"
  }
}
```

## 命令

### 发布

| 命令 | 说明 |
|------|------|
| `deploy` | 交互式构建并发布 |
| `deploy -s my-app` | 指定子域名（如 `my-app.example.com`） |
| `deploy -d app.example.com` | 指定完整域名 |
| `deploy -s my-app -y` | 非交互模式（CI 用，使用配置文件默认值） |
| `deploy --no-clean` | 不清理 COS 上已删除的远程文件 |

**交互式发布流程：**

1. 选择发布方式：子域名 / 完整域名
2. 选择访问协议（默认 HTTP）
3. 是否开启 CDN HTTPS（默认关闭）
4. 确认后执行：构建 → 上传 COS → 配置 CDN → 配置 DNS

**根域名双域名：** 输入 `example.com` 时，会同时创建 `example.com` 与 `www.example.com` 两个 CDN 加速域名，共用同一 COS 路径（如 `sites/example-com/`）。

**外部域名：** 若完整域名不在配置的 `baseDomain` 下，DNS 需手动配置 CNAME；新 CDN 域名需按提示添加 TXT 记录完成归属验证。

### 下线

| 命令 | 说明 |
|------|------|
| `deploy -delete wocao.example.com` | 下线指定 CDN 域名 |
| `deploy -delete wocao.example.com -y` | 跳过确认 |

下线步骤：删除 CDN 加速域名 → 删除 DNSPod CNAME（托管域名）→ 删除 COS 目录。

若 `example.com` 与 `www.example.com` 共用 COS 路径，仅下线其中一个且另一个仍在线时，会保留 COS 资源。

### 其他

| 命令 | 说明 |
|------|------|
| `deploy config` | 配置腾讯云凭证与域名 |
| `deploy init` | 初始化项目 `.autodeployrc` |

## 配置说明

### 全局配置 `~/.autodeploy/config.json`

主要字段：

```json
{
  "tencent": { "secretId", "secretKey", "region" },
  "cos": { "bucket", "prefix" },
  "cdn": { "serviceType", "area", "https", "certId" },
  "dns": { "domain", "recordLine", "ttl" },
  "domain": { "baseDomain", "protocol" }
}
```

- `cdn.area`：境外 COS 建议设为 `overseas`（境内需 ICP 备案）
- `cdn.https` / 交互式选择：控制 CDN HTTPS 服务与证书

### 项目配置 `.autodeployrc`（可选）

```json
{
  "subdomain": "my-app",
  "buildCommand": "vite build",
  "outputDir": "dist",
  "cleanRemote": true
}
```

## 项目结构

```
packages/
  core/    @autodeploy/core  核心逻辑（构建、COS、CDN、DNS）
  cli/     @autodeploy/cli   命令行入口
docs/
  DEVELOPMENT.md             开发文档
scripts/
  setup-bucket.ts            COS 存储桶初始化
```

## 开发

```bash
pnpm install
pnpm build
pnpm test
```

详细设计见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。
