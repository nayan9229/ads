import { ErrorRegistry } from "../src/core/error-registry";
import { ConfigError, ErrorCode } from "../src/core/errors";

describe("ErrorRegistry", () => {
  it("wrap(fn) returns a function that calls fn and preserves the return value", () => {
    const registry = new ErrorRegistry();

    const wrapped = registry.wrap((a: number, b: number) => a + b);

    expect(wrapped(2, 3)).toBe(5);
  });

  it("wrap(fn) catches thrown WrapperError and routes to onError handler", () => {
    const registry = new ErrorRegistry();
    const seen: Array<{ code: string; context: unknown }> = [];
    registry.onError((e) => {
      seen.push({ code: e.code, context: e.context });
    });

    const wrapped = registry.wrap(() => {
      throw new ConfigError("bad", { slotId: "x" });
    });

    const result = wrapped();
    expect(result).toBeUndefined();
    expect(seen).toEqual([{ code: ErrorCode.E_CONFIG_INVALID, context: { slotId: "x" } }]);
  });

  it("fail() emits an event with the given code, message, and context to every handler", () => {
    const registry = new ErrorRegistry();
    const a: unknown[] = [];
    const b: unknown[] = [];
    registry.onError((e) => a.push(e));
    registry.onError((e) => b.push(e));

    registry.fail(ErrorCode.E_TIMEOUT, "auction exceeded 1500ms", { slotId: "s1" });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]).toMatchObject({
      code: ErrorCode.E_TIMEOUT,
      message: "auction exceeded 1500ms",
      context: { slotId: "s1" },
    });
  });

  it("a throwing handler does not block subsequent handlers", () => {
    const registry = new ErrorRegistry();
    const seen: unknown[] = [];
    registry.onError(() => {
      throw new Error("handler bug");
    });
    registry.onError((e) => seen.push(e));

    registry.fail(ErrorCode.E_TIMEOUT, "x");

    expect(seen).toHaveLength(1);
  });
});
