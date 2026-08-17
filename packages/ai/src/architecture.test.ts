import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// "No business service may call an AI model directly. All AI traffic must
// pass through the gateway." -- this is the static enforcement of that
// rule, in the same spirit as packages/runtime/src/architecture.test.ts's
// route-handler checks: a documented invariant a reviewer could miss is
// instead a test that fails the build.
const EXCLUDED_DIRECTORY_NAMES = new Set(["node_modules", ".next", "dist", "coverage"]);
const AI_GATEWAY_PACKAGE_SUFFIX = `${sep}packages${sep}ai`;

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (EXCLUDED_DIRECTORY_NAMES.has(name) || path.endsWith(AI_GATEWAY_PACKAGE_SUFFIX)) return [];
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const FORBIDDEN_PATTERNS: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
  { label: "Anthropic API host", pattern: /api\.anthropic\.com/ },
  { label: "OpenAI API host", pattern: /api\.openai\.com/ },
  { label: "Google Generative Language API host", pattern: /generativelanguage\.googleapis\.com/ },
  { label: "@anthropic-ai/sdk import", pattern: /from\s+["']@anthropic-ai\/sdk["']/ },
  { label: "openai package import", pattern: /from\s+["']openai["']/ },
  { label: "@google/generative-ai import", pattern: /from\s+["']@google\/generative-ai["']/ },
];

describe("AI Gateway architecture", () => {
  const root = process.cwd();
  const sourceFiles = [...files(join(root, "apps")), ...files(join(root, "packages"))].filter(
    (path) => path.endsWith(".ts") || path.endsWith(".tsx"),
  );

  it("keeps every AI model provider call and SDK import inside packages/ai", () => {
    const violations = sourceFiles.flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const matches = FORBIDDEN_PATTERNS.filter(({ pattern }) => pattern.test(source));
      return matches.map(({ label }) => `${relative(root, path)} (${label})`);
    });
    expect(violations).toEqual([]);
  });
});
