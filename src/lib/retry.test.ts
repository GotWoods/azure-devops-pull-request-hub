import { withAuthRetry } from "./retry";

describe("withAuthRetry", () => {
  let delays: number[];

  beforeEach(() => {
    delays = [];
    // Run backoff timers immediately, recording the requested delay
    jest.spyOn(window, "setTimeout").mockImplementation(((callback: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      callback();
      return 0;
    }) as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it("waits longer before retrying an auth failure than a network failure", async () => {
    const operation = jest.fn().mockRejectedValueOnce({ status: 401 }).mockResolvedValueOnce("ok");

    await expect(withAuthRetry(operation, { delayMs: 10 })).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([2000]);
  });

  it("keeps the short delay for network failures", async () => {
    const operation = jest.fn().mockRejectedValueOnce({ status: 503 }).mockResolvedValueOnce("ok");

    await expect(withAuthRetry(operation, { delayMs: 10 })).resolves.toBe("ok");
    expect(delays).toEqual([10]);
  });
});
