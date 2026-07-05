# AGENTS.md — AutoDeploy

## Quick Commands

| Task | Command |
|------|---------|
| Install deps | `pnpm install` |
| Build all | `pnpm build` |
| Test all | `pnpm test` |
| Type-check all | `pnpm typecheck` |
| Dev mode (CLI) | `pnpm dev` |
| Install CLI globally | `cd packages/cli && pnpm add -g .` |
| Setup browser (SEO) | `pnpm setup-browser` |
| Init COS bucket | `pnpm setup-bucket` |

CI needs `CI=true pnpm install` to avoid TTY prompt on module purge.

## Structure

Monorepo with pnpm workspaces, two packages:

- **`packages/core`** (`@autodeploy/core`) — All business logic: config, Vite detection, COS upload, CDN/DNS management, SEO, route discovery, orchestrator
- **`packages/cli`** (`@autodeploy/cli`) — Thin Commander-based CLI wrapping core. No tests

Core barrel export: `packages/core/src/index.ts` re-exports all submodules.

## Key Gotchas

### ESM-only with `.js` extensions
Both packages use `"type": "module"` with NodeNext resolution. All internal imports **must** use `.js` extensions:
```ts
import { something } from './domain.js'  // correct
import { something } from './domain'     // will fail at runtime
```

### No linting
No ESLint or Prettier. Code quality enforced only via TypeScript `strict: true`. Run `pnpm typecheck` to verify.

### Testing
Vitest 2.1.x, only in `@autodeploy/core`. Test files excluded from `tsc` compilation but included by Vitest (`src/**/*.test.ts`). Run a single package: `pnpm --filter @autodeploy/core test`. No integration tests — all unit tests.

### Chinese UI
All user-facing strings (prompts, logs, errors) are in Simplified Chinese.

### Tencent Cloud API quirks
- CDN HTTPS requires toggling **both** `HttpsBilling.Switch` and `Https.Switch` to off simultaneously — setting only one leaves console showing HTTPS enabled
- Root domains auto-expand to both `example.com` and `www.example.com` sharing the same COS prefix
- COS key maps dots to hyphens: `hbshibo.com` → `hbshibo-com`

### Config
Global config: `~/.autodeploy/config.json` (written with `chmod 600`). Env vars can override: `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY`, `AUTODEPLOY_COS_BUCKET`, etc.

### Browser for SEO
SEO features need Chromium via playwright-core. Run `pnpm setup-browser` first. Skip auto-install with `AUTODEPLOY_SKIP_BROWSER_INSTALL=1`.
