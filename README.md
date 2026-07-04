# AutoDeploy

Vite 项目一键发布至腾讯云 COS，自动配置 CDN 与 DNS 解析。

## 快速开始

### 1. 安装

```bash
# 在 monorepo 根目录
pnpm install
pnpm build

# 全局安装 CLI（开发调试，pnpm 11+）
cd packages/cli
pnpm add -g .

# 若 deploy 命令冲突（系统里已有其他 deploy 工具），可改用：
#   pnpm exec deploy --help
# 或在 Vite 项目中本地安装：pnpm add -D @autodeploy/cli
```

### 2. 配置腾讯云

```bash
deploy config
```

按提示填写 SecretId、SecretKey、COS 存储桶、主域名等信息。配置保存在 `~/.autodeploy/config.json`。

也可通过环境变量覆盖：

```bash
export TENCENT_SECRET_ID=AKIDxxxx
export TENCENT_SECRET_KEY=xxxx
export AUTODEPLOY_COS_BUCKET=static-sites-1250000000
export AUTODEPLOY_BASE_DOMAIN=example.com
```

### 3. 初始化 COS 存储桶（首次）

```bash
pnpm setup-bucket
```

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

| 命令 | 说明 |
|------|------|
| `deploy` | 交互式构建并发布 |
| `deploy config` | 配置腾讯云凭证与域名 |
| `deploy init` | 初始化项目 `.autodeployrc` |
| `deploy -s my-app -y` | 非交互模式（CI 用） |
| `deploy --no-clean` | 不清理 COS 远程多余文件 |

## 项目结构

```
packages/
  core/    @autodeploy/core  核心逻辑
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
