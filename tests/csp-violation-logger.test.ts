import { CspViolationLogger } from "../src/core/csp-violation-logger";

describe("CspViolationLogger", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("logs console.warn with structured violation context on dispatched event", () => {
    const logger = new CspViolationLogger();
    logger.start();

    const evt = new Event("securitypolicyviolation") as Event & {
      violatedDirective: string;
      blockedURI: string;
      sourceFile: string;
    };
    evt.violatedDirective = "script-src";
    evt.blockedURI = "https://evil.example.com/x.js";
    evt.sourceFile = "https://publisher.example.com/page";
    document.dispatchEvent(evt);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [tag, payload] = warnSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(tag).toMatch(/CSP violation/i);
    expect(payload).toMatchObject({
      violatedDirective: "script-src",
      blockedURI: "https://evil.example.com/x.js",
      sourceFile: "https://publisher.example.com/page",
    });

    logger.dispose();
  });

  it("dispose() removes the listener — further events are not logged", () => {
    const logger = new CspViolationLogger();
    logger.start();
    logger.dispose();

    const evt = new Event("securitypolicyviolation") as Event & {
      violatedDirective: string;
    };
    evt.violatedDirective = "script-src";
    document.dispatchEvent(evt);

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
