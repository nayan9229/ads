import { bootstrap } from "../src/core/bootstrap";

describe("bootstrap — CSP nonce plumbing", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    delete (window as { AdWrapper?: unknown }).AdWrapper;
  });
  afterEach(() => {
    delete (window as { AdWrapper?: unknown }).AdWrapper;
  });

  it("attaches `nonce` attribute to the injected Prebid script tag", () => {
    bootstrap({
      prebidSrc: "https://cdn.example.com/prebid.js",
      cspNonce: "csp-nonce-xyz",
      consentDisabled: true,
    });

    // Force the loader to inject by registering a slot...
    // ...but registerScript would need pbjs ready. The script injection happens lazily
    // on first getPbjs(). Instead trigger via the loader path directly: the loader is
    // constructed inside bootstrap, but only used when no prebidLoaderOverride supplied.
    // Trigger by creating a slot config + script tag.
    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_csp: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: {} }],
        eager: true,
      },
    };
    const script = document.createElement("script");
    script.id = "slot_csp";
    document.body.appendChild(script);

    const api = (
      window as unknown as { AdWrapper: { registerScript(s: HTMLScriptElement): Promise<void> } }
    ).AdWrapper;
    void api.registerScript(script);

    const injected = document.querySelector(
      'script[src="https://cdn.example.com/prebid.js"]',
    ) as HTMLScriptElement | null;
    expect(injected).not.toBeNull();
    expect(injected!.getAttribute("nonce")).toBe("csp-nonce-xyz");
  });

  it("debug:true attaches a CSP violation listener; debug:false leaves none", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const debugApi = bootstrap({
        prebidSrc: "https://cdn.example.com/prebid.js",
        debug: true,
        consentDisabled: true,
      });

      const evt = new Event("securitypolicyviolation") as Event & {
        violatedDirective: string;
      };
      evt.violatedDirective = "script-src";
      document.dispatchEvent(evt);

      expect(warnSpy).toHaveBeenCalled();

      debugApi.destroyAll();
      delete (window as { AdWrapper?: unknown }).AdWrapper;
    } finally {
      warnSpy.mockRestore();
    }

    // Now without debug — fresh singleton, no listener.
    const warnSpy2 = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      bootstrap({
        prebidSrc: "https://cdn.example.com/prebid.js",
        consentDisabled: true,
      });

      const evt = new Event("securitypolicyviolation") as Event & {
        violatedDirective: string;
      };
      evt.violatedDirective = "script-src";
      document.dispatchEvent(evt);

      expect(warnSpy2).not.toHaveBeenCalled();
    } finally {
      warnSpy2.mockRestore();
    }
  });
});
