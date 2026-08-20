import { test as base, expect } from "@playwright/test";
import { attachBrowserEvidence, captureBrowserEvidence } from "../helpers/browser-evidence";

export const test = base.extend<{ certificationEvidence: void }>({
  certificationEvidence: [async ({ context }, use, testInfo) => {
    const isNegativeScenario = /cannot|denied|fails closed|invalid|logout|stale|unauthenticated|wrong role/i
      .test(testInfo.title);
    const evidence = captureBrowserEvidence(context, {
      expectedHttpStatuses: isNegativeScenario
        ? new Set([400, 401, 403, 404, 409])
        : new Set(),
    });
    await use();
    await attachBrowserEvidence(testInfo, evidence);
  }, { auto: true }],
});

export { expect };
export type {
  APIRequestContext,
  Browser,
  BrowserContext,
  Locator,
  Page,
  TestInfo,
} from "@playwright/test";
