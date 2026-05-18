import { RefreshScheduler } from "../src/core/refresh-scheduler";

describe("RefreshScheduler", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("fires onRefresh after intervalMs", async () => {
    const onRefresh = jest.fn();
    const scheduler = new RefreshScheduler({
      intervalMs: 30000,
      isInView: () => true,
      onRefresh,
    });

    scheduler.start();
    await jest.advanceTimersByTimeAsync(29999);
    expect(onRefresh).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("continues firing at each interval", async () => {
    const onRefresh = jest.fn();
    const scheduler = new RefreshScheduler({
      intervalMs: 1000,
      isInView: () => true,
      onRefresh,
    });

    scheduler.start();
    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(1000);

    expect(onRefresh).toHaveBeenCalledTimes(3);
  });

  it("pauses when document.visibilityState becomes hidden; resumes on visible", async () => {
    const onRefresh = jest.fn();
    let visibility: "visible" | "hidden" = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });

    const scheduler = new RefreshScheduler({
      intervalMs: 1000,
      isInView: () => true,
      onRefresh,
    });

    scheduler.start();
    await jest.advanceTimersByTimeAsync(500);

    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));

    await jest.advanceTimersByTimeAsync(2000);
    expect(onRefresh).not.toHaveBeenCalled();

    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));

    await jest.advanceTimersByTimeAsync(1000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("pauses on isInView false; resumes via viewport notifier", async () => {
    let inView = true;
    let notifyResume: (() => void) | undefined;
    const onRefresh = jest.fn();

    const scheduler = new RefreshScheduler({
      intervalMs: 1000,
      isInView: () => inView,
      onRefresh,
      viewportNotifier: (cb) => {
        notifyResume = cb;
        return () => {};
      },
    });

    scheduler.start();
    inView = false;
    notifyResume?.();
    await jest.advanceTimersByTimeAsync(2000);
    expect(onRefresh).not.toHaveBeenCalled();

    inView = true;
    notifyResume?.();
    await jest.advanceTimersByTimeAsync(1000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("halts at sessionCap fires; further intervals do not fire onRefresh", async () => {
    const onRefresh = jest.fn();
    const scheduler = new RefreshScheduler({
      intervalMs: 1000,
      isInView: () => true,
      onRefresh,
      sessionCap: 3,
    });

    scheduler.start();
    for (let i = 0; i < 5; i++) {
      await jest.advanceTimersByTimeAsync(1000);
    }
    expect(onRefresh).toHaveBeenCalledTimes(3);
  });

  it("cancel() halts and is idempotent", async () => {
    const onRefresh = jest.fn();
    const scheduler = new RefreshScheduler({
      intervalMs: 1000,
      isInView: () => true,
      onRefresh,
    });

    scheduler.start();
    expect(jest.getTimerCount()).toBe(1);

    scheduler.cancel();
    expect(jest.getTimerCount()).toBe(0);

    expect(() => scheduler.cancel()).not.toThrow();

    await jest.advanceTimersByTimeAsync(5000);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
