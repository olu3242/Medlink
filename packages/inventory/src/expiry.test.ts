import { describe, expect, it, vi } from "vitest";
import {
  InventoryExpiryWorker,
  type InventoryExpiryRepository,
} from "./expiry";

describe("inventory expiry worker", () => {
  it("delegates a bounded batch to the database transaction", async () => {
    const repository = {
      releaseExpired: vi.fn(async () => ({
        releasedHolds: 2,
        expiredBatches: 1,
      })),
    } satisfies InventoryExpiryRepository;
    const worker = new InventoryExpiryWorker(repository);

    await expect(worker.run(25)).resolves.toEqual({
      releasedHolds: 2,
      expiredBatches: 1,
    });
    expect(repository.releaseExpired).toHaveBeenCalledWith(25);
  });

  it("rejects unsafe batch sizes before touching persistence", () => {
    const repository = {
      releaseExpired: vi.fn(),
    } satisfies InventoryExpiryRepository;
    const worker = new InventoryExpiryWorker(repository);

    expect(() => worker.run(1_001)).toThrow();
    expect(repository.releaseExpired).not.toHaveBeenCalled();
  });
});
