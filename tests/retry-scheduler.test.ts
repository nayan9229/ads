import { RetryScheduler } from "../src/core/retry-scheduler";

const DEFAULT_DELAYS = [1000, 2000, 4000, 8000, 16000];

describe("RetryScheduler", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("schedules attempts at the exact delay sequence", async () => {
    const calls: number[] = [];
    const attempt = jest.fn(async () => {
      calls.push(Date.now());
      return false;
    });

    const scheduler = new RetryScheduler({
      delaysMs: DEFAULT_DELAYS,
      isInView: () => true,
      attempt,
    });

    const start = Date.now();
    scheduler.start();

    for (const ms of DEFAULT_DELAYS) {
      await jest.advanceTimersByTimeAsync(ms);
    }

    expect(attempt).toHaveBeenCalledTimes(5);
    const deltas = calls.map((t) => t - start);
    expect(deltas).toEqual([1000, 3000, 7000, 15000, 31000]);
  });

  it("stops scheduling once an attempt returns true", async () => {
    const attempt = jest
      .fn<Promise<boolean>, []>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);

    const scheduler = new RetryScheduler({
      delaysMs: DEFAULT_DELAYS,
      isInView: () => true,
      attempt,
    });

    scheduler.start();

    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(2000);

    expect(attempt).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(4000);
    await jest.advanceTimersByTimeAsync(8000);
    await jest.advanceTimersByTimeAsync(16000);

    expect(attempt).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("fires onExhausted exactly once after all 5 attempts return false", async () => {
    const attempt = jest.fn(async () => false);
    const onExhausted = jest.fn();

    const scheduler = new RetryScheduler({
      delaysMs: DEFAULT_DELAYS,
      isInView: () => true,
      attempt,
      onExhausted,
    });

    scheduler.start();

    for (const ms of DEFAULT_DELAYS) {
      await jest.advanceTimersByTimeAsync(ms);
    }

    expect(attempt).toHaveBeenCalledTimes(5);
    expect(onExhausted).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(60000);
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  it("pauses scheduling while isInView() returns false; resumes on notifier signal", async () => {
    let inView = true;
    let notifyResume: (() => void) | undefined;
    const subscribers: Array<() => void> = [];

    const attempt = jest.fn(async () => false);

    const scheduler = new RetryScheduler({
      delaysMs: DEFAULT_DELAYS,
      isInView: () => inView,
      attempt,
      viewportNotifier: (cb) => {
        subscribers.push(cb);
        notifyResume = cb;
        return () => {
          const i = subscribers.indexOf(cb);
          if (i >= 0) subscribers.splice(i, 1);
        };
      },
    });

    scheduler.start();
    await jest.advanceTimersByTimeAsync(1000);
    expect(attempt).toHaveBeenCalledTimes(1);

    inView = false;
    await jest.advanceTimersByTimeAsync(2000);
    expect(attempt).toHaveBeenCalledTimes(1);

    inView = true;
    notifyResume?.();
    await jest.advanceTimersByTimeAsync(0);

    expect(attempt).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(4000);
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("cancel() mid-delay clears pending timer and leaves no leaked handles", async () => {
    const attempt = jest.fn(async () => false);
    const scheduler = new RetryScheduler({
      delaysMs: DEFAULT_DELAYS,
      isInView: () => true,
      attempt,
    });

    scheduler.start();
    expect(jest.getTimerCount()).toBe(1);

    scheduler.cancel();
    expect(jest.getTimerCount()).toBe(0);

    await jest.advanceTimersByTimeAsync(60000);
    expect(attempt).not.toHaveBeenCalled();
  });

  it("cancel() after exhaustion is idempotent (no double-cleanup, no extra calls)", async () => {
    const attempt = jest.fn(async () => false);
    const onExhausted = jest.fn();
    const scheduler = new RetryScheduler({
      delaysMs: DEFAULT_DELAYS,
      isInView: () => true,
      attempt,
      onExhausted,
    });

    scheduler.start();
    for (const ms of DEFAULT_DELAYS) {
      await jest.advanceTimersByTimeAsync(ms);
    }
    expect(onExhausted).toHaveBeenCalledTimes(1);

    expect(() => scheduler.cancel()).not.toThrow();
    expect(() => scheduler.cancel()).not.toThrow();
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });
});
