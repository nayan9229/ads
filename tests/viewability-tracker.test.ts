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

// P2 (D65): in a SafeFrame, IntersectionObserver is blind cross-origin, so the
// tracker polls the SafeFrame host API `$sf.ext.inViewPercentage()`.
describe("ViewabilityTracker — safeframe ($sf.ext)", () => {
  let inView = 0;
  beforeEach(() => {
    jest.useFakeTimers();
    inView = 0;
    (window as unknown as { $sf?: unknown }).$sf = { ext: { inViewPercentage: () => inView } };
  });
  afterEach(() => {
    jest.useRealTimers();
    delete (window as unknown as { $sf?: unknown }).$sf;
  });

  it("resolves after sustained in-view measured via $sf.ext.inViewPercentage", async () => {
    inView = 70; // 70% ≥ 0.5 threshold
    const tracker = new ViewabilityTracker("safeframe");
    let viewable = false;
    void tracker
      .track(document.createElement("div"), { threshold: 0.5, durationMs: 1000 })
      .then(() => {
        viewable = true;
      });

    await jest.advanceTimersByTimeAsync(200); // first poll meets → duration timer starts
    await jest.advanceTimersByTimeAsync(999);
    expect(viewable).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(viewable).toBe(true);
  });

  it("resets the duration timer when in-view drops below threshold", async () => {
    inView = 70;
    const tracker = new ViewabilityTracker("safeframe");
    let viewable = false;
    void tracker
      .track(document.createElement("div"), { threshold: 0.5, durationMs: 1000 })
      .then(() => {
        viewable = true;
      });

    await jest.advanceTimersByTimeAsync(400); // meets, timer running
    inView = 10; // drop below threshold
    await jest.advanceTimersByTimeAsync(2000);
    expect(viewable).toBe(false); // timer was reset
  });

  it("currentInView returns the measured fraction in safeframe, null elsewhere", () => {
    inView = 40;
    expect(new ViewabilityTracker("safeframe").currentInView()).toBeCloseTo(0.4);
    expect(new ViewabilityTracker("top").currentInView()).toBeNull();
    expect(new ViewabilityTracker("friendly-iframe").currentInView()).toBeNull();
  });

  it("dispose() stops the poll for a never-viewable slot (no leaked interval)", async () => {
    inView = 0; // never reaches threshold
    const spy = jest.fn(() => inView);
    (window as unknown as { $sf?: unknown }).$sf = { ext: { inViewPercentage: spy } };
    const tracker = new ViewabilityTracker("safeframe");
    let resolved = false;
    void tracker
      .track(document.createElement("div"), { threshold: 0.5, durationMs: 1000 })
      .then(() => {
        resolved = true;
      });

    await jest.advanceTimersByTimeAsync(600); // a few polls happen
    const callsBefore = spy.mock.calls.length;
    expect(callsBefore).toBeGreaterThan(0);

    tracker.dispose();
    await jest.advanceTimersByTimeAsync(2000);
    expect(spy.mock.calls.length).toBe(callsBefore); // no further polls after dispose
    expect(resolved).toBe(false);
  });
});
