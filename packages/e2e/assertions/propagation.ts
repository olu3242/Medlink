import { expect, type Locator, type Page } from "@playwright/test";

export interface InputPropagationProbe<TPersisted> {
  readonly input: Locator;
  readonly sentinel: string;
  readonly submit: Locator;
  readonly response: (page: Page) => Promise<void>;
  readonly persisted: () => Promise<TPersisted>;
  readonly persistedValue: (record: TPersisted) => unknown;
  readonly reloaded: Locator;
}

export async function assertPersistedValue<T>(
  load: () => Promise<T>,
  select: (record: T) => unknown,
  expected: unknown,
): Promise<void> {
  await expect.poll(async () => select(await load())).toEqual(expected);
}

export async function assertInputPropagation<TPersisted>(
  page: Page,
  probe: InputPropagationProbe<TPersisted>,
): Promise<void> {
  await probe.input.fill(probe.sentinel);
  await expect(probe.input).toHaveValue(probe.sentinel);
  await Promise.all([probe.response(page), probe.submit.click()]);
  await assertPersistedValue(probe.persisted, probe.persistedValue, probe.sentinel);
  await page.reload();
  await expect(probe.reloaded).toHaveValue(probe.sentinel);
}

export async function assertResponsiveControl(
  control: Locator,
  observeEffect: () => Promise<void>,
): Promise<void> {
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  await Promise.all([observeEffect(), control.click()]);
}
