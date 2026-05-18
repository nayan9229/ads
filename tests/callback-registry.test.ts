import { CallbackRegistry } from "../src/core/callback-registry";
import { ErrorRegistry } from "../src/core/error-registry";

describe("CallbackRegistry", () => {
  it("on(event, fn) then emit(event, payload) invokes fn with payload", () => {
    const registry = new CallbackRegistry(new ErrorRegistry());
    const calls: unknown[] = [];
    registry.on("ready", (p) => calls.push(p));

    registry.emit("ready", { ts: 123 });

    expect(calls).toEqual([{ ts: 123 }]);
  });

  it("a throwing handler does not block subsequent handlers", () => {
    const registry = new CallbackRegistry(new ErrorRegistry());
    const ok: unknown[] = [];
    registry.on("ready", () => {
      throw new Error("bad handler");
    });
    registry.on("ready", (p) => ok.push(p));

    registry.emit("ready", "payload");

    expect(ok).toEqual(["payload"]);
  });

  it("unsubscribe returned by on() removes the handler", () => {
    const registry = new CallbackRegistry(new ErrorRegistry());
    const calls: unknown[] = [];
    const off = registry.on("ready", (p) => calls.push(p));

    registry.emit("ready", 1);
    off();
    registry.emit("ready", 2);

    expect(calls).toEqual([1]);
  });
});
