import { LazyLoadGate } from "../src/gates/lazy-load-gate";
import {
  installIntersectionObserverStub,
  uninstallIntersectionObserverStub,
  triggerEntry,
} from "./helpers/iox-stub";

describe("LazyLoadGate", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    installIntersectionObserverStub();
  });
  afterEach(() => {
    uninstallIntersectionObserverStub();
  });

  it("resolves once the observed element first intersects", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);

    const gate = new LazyLoadGate({ rootMargin: "400px 0px" });
    const p = gate.gate(el);

    triggerEntry(el, true);

    await expect(p).resolves.toBeUndefined();
  });

  it("stays pending while element has not intersected", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);

    const gate = new LazyLoadGate();
    let resolved = false;
    void gate.gate(el).then(() => {
      resolved = true;
    });

    triggerEntry(el, false, 0);

    await Promise.resolve();
    expect(resolved).toBe(false);
  });

  it("disconnects after first resolution; later intersection events have no effect", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);

    const gate = new LazyLoadGate();
    let resolveCount = 0;
    void gate.gate(el).then(() => {
      resolveCount += 1;
    });

    triggerEntry(el, true);
    await Promise.resolve();
    expect(resolveCount).toBe(1);

    triggerEntry(el, true);
    await Promise.resolve();
    expect(resolveCount).toBe(1);
  });
});
