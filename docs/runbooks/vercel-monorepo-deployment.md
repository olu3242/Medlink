# Vercel monorepo deployment contract

MedLink uses one npm workspace lockfile and one Vercel project per independently deployed Next.js application. Each application owns its direct `next`, `react`, and `react-dom` dependency declarations. npm may hoist the compatible packages to the repository root, but framework detection must never depend on that implementation detail.

## Primary web project

Configure `medlink` (the actual canonical Vercel project name; this document
previously called it `medlink-web`, which does not exist as a project) as
follows:

| Setting | Value |
| --- | --- |
| Git repository | `olu3242/Medlink` |
| Production branch | `main` |
| Root Directory | `apps/web` |
| Framework Preset | Next.js |
| Build Command | Default (`next build`) |
| Install Command | Default (npm workspace-aware install) |
| Output Directory | Default (`.next`, relative to `apps/web`) |
| Include source files outside Root Directory | Enabled |

Outside-root source access is required because `apps/web` consumes source packages from the repository's `packages/*` npm workspaces. The root `package-lock.json` remains the installation authority. Do not set the output directory to `apps/web/.next`, copy build output to the repository root, or commit generated `.next` files.

## Project topology

| Vercel project | Root Directory | Classification |
| --- | --- | --- |
| `medlink` | `apps/web` | CANONICAL — the only project with real persona implementation code (`/patient /pharmacist /pharmacy /provider /admin`); production auto-deploys from `main` |
| `medlink-patient` | `apps/patient` | LEGACY — thin re-export stub of `apps/web`; no unique UI/API/webhook/cron logic of its own; kept only as a fallback/transitional standalone deployment |
| `medlink-pharmacy` | `apps/pharmacy` | LEGACY — thin re-export stub of `apps/web`; no unique UI/API/webhook/cron logic of its own; kept only as a fallback/transitional standalone deployment |
| `medlink-pharmacist` | `apps/pharmacist` | LEGACY — thin re-export stub of `apps/web`; no unique UI/API/webhook/cron logic of its own; kept only as a fallback/transitional standalone deployment |
| `medlink-admin` | `apps/admin` | LEGACY — thin re-export stub of `apps/web`; no unique UI/API/webhook/cron logic of its own; kept only as a fallback/transitional standalone deployment |
| `medlink-dashboard` | `apps/dashboard` | Build-capable internal/deferred application; no production project required yet |
| `medlink-developer` | `apps/developer` | Build-capable internal/deferred application; no production project required yet |
| `medlink-provider` | `apps/provider` | Build-capable deferred provider application; no production project required yet |

Each of the four LEGACY projects still owns its own `/auth/sign-in`, `/auth/callback`, and `middleware.ts` — those are real, app-specific auth bootstrapping code, not re-export stubs, and are the only reason each project remains independently functional. No webhook, cron, or background-job route exists in any of them (confirmed by directory search); the only webhook receiver in the repository (`/api/whatsapp/webhook`) lives exclusively in `apps/web`.

Each future Vercel project must use its application directory as Root Directory, leave framework/build/install/output settings at their detected defaults, and enable outside-root source files when it imports `@medlink/*` workspaces.

## Repository guard

Run `npm run test:deployment-contract`. The test discovers applications whose scripts invoke `next dev`, `next build`, or `next start` and rejects missing or divergent direct runtime dependencies, missing lockfile declarations, and nested conflicting Next.js installations.
