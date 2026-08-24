import { writeFile } from "node:fs/promises";
import type { BrowserContext, ConsoleMessage, Page, TestInfo } from "@playwright/test";

export interface BrowserEvidenceOptions {
  readonly expectedHttpStatuses?: ReadonlySet<number>;
  readonly expectedConsolePatterns?: readonly RegExp[];
}

export interface BrowserEvidence {
  readonly unexpectedResponses: Array<{ url: string; status: number; method: string }>;
  readonly failedRequests: Array<{ url: string; method: string; error: string }>;
  readonly consoleErrors: Array<{ page: string; text: string }>;
  readonly pageErrors: Array<{ page: string; message: string }>;
}

export function captureBrowserEvidence(
  context: BrowserContext,
  options: BrowserEvidenceOptions = {},
): BrowserEvidence {
  const evidence: BrowserEvidence = {
    unexpectedResponses: [], failedRequests: [], consoleErrors: [], pageErrors: [],
  };
  const expectedStatuses = options.expectedHttpStatuses ?? new Set<number>();
  const expectedConsole = options.expectedConsolePatterns ?? [];
  const observePage = (page: Page) => {
    page.on("console", (message: ConsoleMessage) => {
      if (message.type() === "error" && !expectedConsole.some((pattern) => pattern.test(message.text()))) {
        evidence.consoleErrors.push({ page: page.url(), text: message.text() });
      }
    });
    page.on("pageerror", (error) => {
      evidence.pageErrors.push({ page: page.url(), message: error.message });
    });
  };
  context.on("response", (response) => {
    const status = response.status();
    if (status >= 400 && !expectedStatuses.has(status)) {
      evidence.unexpectedResponses.push({
        url: response.url(), status, method: response.request().method(),
      });
    }
  });
  context.on("requestfailed", (request) => {
    if (request.failure()?.errorText.includes("ERR_ABORTED")) return;
    evidence.failedRequests.push({
      url: request.url(), method: request.method(), error: request.failure()?.errorText ?? "unknown",
    });
  });
  context.pages().forEach(observePage);
  context.on("page", observePage);
  return evidence;
}

export async function attachBrowserEvidence(
  testInfo: TestInfo,
  evidence: BrowserEvidence,
): Promise<void> {
  const count = evidence.unexpectedResponses.length + evidence.failedRequests.length
    + evidence.consoleErrors.length + evidence.pageErrors.length;
  if (count === 0) return;
  const evidencePath = testInfo.outputPath("browser-network-evidence.json");
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await testInfo.attach("browser-network-evidence", {
    path: evidencePath, contentType: "application/json",
  });
  throw new Error(`Unexpected browser/network errors: ${count}`);
}
