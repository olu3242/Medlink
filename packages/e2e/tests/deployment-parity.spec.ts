import { expect, test } from "../fixtures/certification-test";

const origins = {
  patient: process.env.MEDLINK_E2E_PATIENT_URL ?? "http://localhost:3000",
  pharmacy: process.env.MEDLINK_E2E_PHARMACY_URL ?? "http://localhost:3002",
  pharmacist: process.env.MEDLINK_E2E_PHARMACIST_URL ?? "http://localhost:3003",
  web: process.env.MEDLINK_E2E_WEB_URL ?? "http://localhost:3004",
};

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

test("MED-DEP-001 configured application origins expose responsive, interactive surfaces", async ({ page }, testInfo) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const [app, origin] of Object.entries(origins)) {
      const url = app === "web" ? origin : `${origin}/auth/sign-in`;
      const response = await page.goto(url);
      expect(response?.status(), `${app} ${url}`).toBeLessThan(400);
      await expect(page.locator("body")).not.toBeEmpty();
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        offenders: Array.from(document.querySelectorAll("body *"))
          .map((element) => ({
            tag: element.tagName,
            className: typeof element.className === "string" ? element.className : "",
            left: Math.round(element.getBoundingClientRect().left),
            right: Math.round(element.getBoundingClientRect().right),
          }))
          .filter(({ left, right }) => left < 0 || right > document.documentElement.clientWidth)
          .slice(0, 12),
      }));
      expect(dimensions.scrollWidth, `${app} horizontal overflow: ${JSON.stringify(dimensions.offenders)}`)
        .toBeLessThanOrEqual(dimensions.clientWidth);

      if (app === "web") {
        const primaryLink = page.locator("a.button:visible").first();
        await expect(primaryLink).toBeVisible();
        await expect(primaryLink).toBeEnabled();
      } else {
        const email = page.locator('input[type="email"]');
        const password = page.locator('input[autocomplete="current-password"]');
        await expect(email.first()).toBeVisible();
        await email.first().fill("parity-probe@example.test");
        await expect(email.first()).toHaveValue("parity-probe@example.test");
        await expect(password).toBeVisible();
        await password.fill("Parity-probe-password!9");
        await expect(password).toHaveValue("Parity-probe-password!9");
        await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
      }

      const screenshot = await page.screenshot({ fullPage: true });
      await testInfo.attach(`${app}-${viewport.name}`, {
        body: screenshot,
        contentType: "image/png",
      });
    }
  }
});

test("MED-DEP-002 worker host exposes live and ready health contracts", async ({ request }) => {
  for (const endpoint of ["live", "ready"]) {
    const response = await request.get(`${origins.web}/health/${endpoint}`);
    expect(response.status(), await response.text()).toBe(200);
  }
});
