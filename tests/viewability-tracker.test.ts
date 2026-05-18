import { ViewabilityTracker } from "../src/gates/viewability-tracker";
import {
  installIntersectionObserverStub,
  uninstallIntersectionObserverStub,
  triggerEntry,
} from "./helpers/iox-stub";

describe("ViewabilityTracker", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    jest.useFakeTimers();
    installIntersectionObserverStub();
  });
  afterEach(() => {
    jest.useRealTimers();
    uninstallIntersectionObserverStub();
  });

  it("resolves after 1s of sustained intersection at ratio >= 0.5 (display)", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);

    const tracker = new ViewabilityTracker();
    let viewable = false;
    void tracker.track(el, { threshold: 0.5, durationMs: 1000 }).then(() => {
      viewable = true;
    });

    triggerEntry(el, true, 0.6);
    await jest.advanceTimersByTimeAsync(500);
    expect(viewable).toBe(false);

    await jest.advanceTimersByTimeAsync(500);
    expect(viewable).toBe(true);
  });

  it("resets the timer if intersection drops below threshold before durationMs", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);

    const tracker = new ViewabilityTracker();
    let viewable = false;
    void tracker.track(el, { threshold: 0.5, durationMs: 1000 }).then(() => {
      viewable = true;
    });

    triggerEntry(el, true, 0.6);
    await jest.advanceTimersByTimeAsync(500);

    triggerEntry(el, false, 0.2);
    await jest.advanceTimersByTimeAsync(1000);
    expect(viewable).toBe(false);

    triggerEntry(el, true, 0.6);
    await jest.advanceTimersByTimeAsync(999);
    expect(viewable).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    expect(viewable).toBe(true);
  });

  it("honors a 2s durationMs for video-style viewability", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);

    const tracker = new ViewabilityTracker();
    let viewable = false;
    void tracker.track(el, { threshold: 0.5, durationMs: 2000 }).then(() => {
      viewable = true;
    });

    triggerEntry(el, true, 0.7);
    await jest.advanceTimersByTimeAsync(1999);
    expect(viewable).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    expect(viewable).toBe(true);
  });
});
