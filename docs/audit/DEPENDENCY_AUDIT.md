# Dependency Security Audit

`npm audit` reports **15 high-severity findings, 0 critical**, as of this
pass. Every one of them requires a major-version bump (`npm audit fix`
without `--force` resolves none of them: `fixAvailable.isSemVerMajor` is
`true` for all 15). None were force-upgraded unilaterally — see "Why not
just fix them" below.

## What's actually flagged

| Package | Direct or transitive | Real exposure in this repo |
| --- | --- | --- |
| `eslint`, `@eslint/config-array`, `@eslint/eslintrc`, `brace-expansion`, `minimatch` | Direct devDependency + its own transitives | Dev/CI tooling only. Never bundled, never runs against untrusted input — it lints this repo's own source. |
| `eslint-config-next`, `eslint-plugin-import`, `eslint-plugin-jsx-a11y`, `eslint-plugin-react` | Transitive via `eslint-config-next` | Same as above. |
| `@vitest/coverage-v8`, `glob`, `test-exclude` | Direct devDependency + its transitives | Test-runner tooling only; never shipped. |
| `postcss` | Transitive via `next` | Processes this repo's own trusted CSS (Tailwind output) at Next.js's build time. The flagged advisories (XSS via unescaped `</style>`, source-map path traversal) require processing **attacker-controlled** CSS or source-map comments — this repo never does. |
| `sharp` | Transitive via `next` (optional, for `next/image`) | **Unused.** `grep -rn "next/image\|from \"sharp\""` across every app returns nothing — no route calls Next's Image Optimization API or imports `sharp` directly. The vulnerable code path is present on disk but never executed. |
| `next` itself | Direct dependency | Audit's "high" rating on `next` is **entirely inherited** from `postcss`/`sharp` (`npm audit`'s `via` field lists only `["postcss", "sharp"]` — no direct Next.js CVE). The suggested "fix" (downgrade to `next@9.3.3`) is an npm-audit artifact, not a real recommendation — the actual fix is whatever future Next.js patch release bundles updated `postcss`/`sharp`, not something this repo controls independently. |

## Why not just fix them

Every fix path is a major-version bump: ESLint 9 → 10, `@vitest/coverage-v8`
3 → 4, or a Next.js version jump that itself changes what `postcss`/`sharp`
versions get bundled. None of these are safely verifiable in this session:

- There's no live PostgreSQL/Supabase environment to run a full regression
  pass against after a Next.js major bump (see
  `docs/audit/RC1_SPRINT_REPORT.md` Phase 1).
- ESLint 9 → 10 and the `eslint-config-next` chain risk silently changing
  which lint rules fire, which this session can't distinguish from "the
  new version found real issues" versus "the new version's defaults
  changed."
- Forcing an untested major bump to close an audit finding that has close
  to zero real exposure in this codebase (unused `sharp`, build-time-only
  `postcss`, dev-only `eslint`/`vitest`) would trade a low-probability,
  low-impact finding for a real risk of breaking the build or CI gate —
  the opposite of "every change must reduce certification risk."

## Recommendation

Not urgent given the exposure analysis above, but worth doing deliberately
rather than never:

1. Bump `@vitest/coverage-v8` to v4 in an isolated commit, run
   `npm run check` and `npm run build` to confirm nothing regresses, and
   accept if clean — this is the least risky of the three bump chains,
   since it only touches test/coverage tooling.
2. Bump ESLint + `eslint-config-next` together (they're interdependent) in
   an isolated commit, review any newly-firing lint rules deliberately
   rather than blanket-suppressing them.
3. Track the Next.js major-version upgrade as separate, larger work with
   its own test plan — not a dependency-audit line item.

None of these block RC1 certification; they're dependency hygiene, not a
production security gap given the exposure analysis above.
