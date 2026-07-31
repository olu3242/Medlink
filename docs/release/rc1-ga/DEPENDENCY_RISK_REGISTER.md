# RC1 Dependency Risk Register

Date: 2026-07-30  
Source: `npm audit --json` against the exact locked installation  
Result: 15 high, 0 critical

No package was upgraded and no forced audit fix was applied.

| Package | Direct | Profile | Severity | Impact/exploitability assessment | Fix posture | RC1 disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `@eslint/config-array` | No | Dev | High | Build-time glob expansion DoS; not shipped as application runtime code | ESLint major suggested | Defer with CI input controls |
| `@eslint/eslintrc` | No | Dev | High | Same development-toolchain path | ESLint major suggested | Defer with CI input controls |
| `@vitest/coverage-v8` | Yes | Dev | High | Coverage processing only; untrusted repository input could exhaust CI | Vitest major suggested | Defer to approved maintenance release |
| `brace-expansion` | No | Dev | High | Unbounded pattern expansion can exhaust CI memory | Toolchain major suggested | Defer; restrict untrusted patterns |
| `eslint` | Yes | Dev | High | Aggregates minimatch findings; lint-time availability impact | Major upgrade suggested | Defer to approved maintenance release |
| `eslint-config-next` | Yes | Dev | High | Aggregates lint-plugin findings; audit fix recommendation is incompatible | Unsafe/inapplicable audit suggestion | Document; do not force-fix |
| `eslint-plugin-import` | No | Dev | High | Lint-time pattern processing | Toolchain change required | Defer |
| `eslint-plugin-jsx-a11y` | No | Dev | High | Lint-time pattern processing | Toolchain change required | Defer |
| `eslint-plugin-react` | No | Dev | High | Lint-time pattern processing | Transitive update available | Defer |
| `glob` | No | Dev | High | Coverage traversal can reach vulnerable minimatch path | Coverage major suggested | Defer |
| `minimatch` | No | Dev | High | Crafted patterns can cause resource exhaustion | Toolchain major suggested | Defer |
| `test-exclude` | No | Dev | High | Coverage-only transitive path | Coverage major suggested | Defer |
| `next` | Yes | Prod | High aggregate | Aggregate entry caused by bundled PostCSS and optional Sharp; no reliable non-breaking audit fix is offered | Audit suggests incompatible downgrade | Track underlying findings separately |
| `postcss` | No | Prod/build | High | Crafted CSS/source maps can disclose files; production exploitability depends on whether untrusted CSS is processed | Patched transitive version exists but requires compatibility validation | **GA risk acceptance or approved remediation required** |
| `sharp` | No | Optional prod | High | Vulnerable image-processing library; impact depends on whether production invokes Next image optimization on untrusted images | Patched Sharp line exists; audit suggests incompatible Next change | Exclude only with deployment proof, or remediate in approved maintenance branch |

## Decision

The twelve development-toolchain entries are not deployed runtime code and may
be accepted temporarily by the accountable Security Lead. PostCSS and Sharp
remain production-profile findings requiring written disposition. This register
does not itself accept risk; it records the acceptance decision that must be
signed before GA.

