import { describe, expect, it, vi } from "vitest";
import { isTransientFetchError, withTransientRetry } from "./retryTransientFetch";

describe("withTransientRetry", () => {
  it("retries transient failures with exponential delays", async () => {
    vi.useFakeTimers();
    const request = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue({ data: "ok" });

    const result = withTransientRetry(request, 2, 10);
    await vi.advanceTimersByTimeAsync(30);

    await expect(result).resolves.toEqual({ data: "ok" });
    expect(request).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("does not retry credential errors", async () => {
    const error = new Error("Invalid login credentials");
    const request = vi.fn().mockRejectedValue(error);

    await expect(withTransientRetry(request)).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("recognizes retryable auth errors", () => {
    expect(isTransientFetchError({ name: "AuthRetryableFetchError" })).toBe(true);
  });
});