# Vercel monorepo deployment contract

MedLink uses one npm workspace lockfile and one Vercel project per independently deployed Next.js application. Each application owns its direct `next`, `react`, and `react-dom` dependency declarations. npm may hoist the compatible packages to the repository root, but framework detection must never depend on that implementation detail.

## Primary web project

Configure `medlink-web` as follows:

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
| `medlink-web` | `apps/web` | Primary production web/runtime application |
| `medlink-patient` | `apps/patient` | Independently deployable patient application |
| `medlink-pharmacy` | `apps/pharmacy` | Independently deployable pharmacy application |
| `medlink-pharmacist` | `apps/pharmacist` | Independently deployable pharmacist application |
| `medlink-admin` | `apps/admin` | Independently deployable administration application |
| `medlink-dashboard` | `apps/dashboard` | Build-capable internal/deferred application; no production project required yet |
| `medlink-developer` | `apps/developer` | Build-capable internal/deferred application; no production project required yet |
| `medlink-provider` | `apps/provider` | Build-capable deferred provider application; no production project required yet |

Each future Vercel project must use its application directory as Root Directory, leave framework/build/install/output settings at their detected defaults, and enable outside-root source files when it imports `@medlink/*` workspaces.

## Repository guard

Run `npm run test:deployment-contract`. The test discovers applications whose scripts invoke `next dev`, `next build`, or `next start` and rejects missing or divergent direct runtime dependencies, missing lockfile declarations, and nested conflicting Next.js installations.
