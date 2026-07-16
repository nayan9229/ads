import { ConfigRegistry } from "../src/core/config-registry";
import { ConfigError, ErrorCode } from "../src/core/errors";

describe("ConfigRegistry", () => {
  it("returns a frozen validated config for a valid banner slot", () => {
    const registry = new ConfigRegistry();

    const result = registry.register("homepage_300x250_top", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: { placementId: 13144370 } }],
    });

    expect(result.mediaTypes.banner).toBeDefined();
    expect(result.mediaTypes.banner?.sizes).toEqual([[300, 250]]);
    expect(result.bidders).toHaveLength(1);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("throws ConfigError when `mediaTypes` is missing", () => {
    const registry = new ConfigRegistry();

    let caught: unknown;
    try {
      registry.register("bad_slot", {
        bidders: [{ bidder: "appnexus", params: {} }],
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).code).toBe(ErrorCode.E_CONFIG_INVALID);
    expect((caught as ConfigError).context).toMatchObject({
      slotId: "bad_slot",
      field: "mediaTypes",
    });
  });

  it("throws ConfigError when mediaTypes has no declared format", () => {
    const registry = new ConfigRegistry();

    expect(() =>
      registry.register("bad_slot", {
        mediaTypes: {},
        bidders: [{ bidder: "appnexus", params: {} }],
      }),
    ).toThrow(ConfigError);
  });

  it("rejects non-boolean shrinkToAdSize", () => {
    const registry = new ConfigRegistry();
    expect(() =>
      registry.register("slot_bad_shrink", {
        mediaTypes: { banner: { sizes: [[300, 250]], shrinkToAdSize: "yes" } },
        bidders: [{ bidder: "appnexus", params: {} }],
      }),
    ).toThrow(ConfigError);
  });

  it("accepts a breakpoint map for banner sizes and preserves structure", () => {
    const registry = new ConfigRegistry();
    const result = registry.register("slot_bp", {
      mediaTypes: {
        banner: {
          sizes: {
            "0-767": [[300, 250]],
            "768-1199": [
              [728, 90],
              [300, 250],
            ],
            "1200+": [
              [970, 250],
              [728, 90],
            ],
          },
        },
      },
      bidders: [{ bidder: "appnexus", params: {} }],
    });

    expect(result.mediaTypes.banner?.sizes).toEqual({
      "0-767": [[300, 250]],
      "768-1199": [
        [728, 90],
        [300, 250],
      ],
      "1200+": [
        [970, 250],
        [728, 90],
      ],
    });
  });

  it("rejects breakpoint map with malformed key", () => {
    const registry = new ConfigRegistry();
    expect(() =>
      registry.register("slot_bad_bp", {
        mediaTypes: { banner: { sizes: { abc: [[300, 250]] } } },
        bidders: [{ bidder: "appnexus", params: {} }],
      }),
    ).toThrow(ConfigError);
  });

  it("rejects empty breakpoint map", () => {
    const registry = new ConfigRegistry();
    expect(() =>
      registry.register("slot_empty_bp", {
        mediaTypes: { banner: { sizes: {} } },
        bidders: [{ bidder: "appnexus", params: {} }],
      }),
    ).toThrow(ConfigError);
  });

  it("accepts a native slot config with template + requiredAssets", () => {
    const registry = new ConfigRegistry();
    const result = registry.register("slot_native", {
      mediaTypes: {
        native: {
          template: "<div>{{title}}</div>",
          requiredAssets: ["title"],
        },
      },
      bidders: [{ bidder: "appnexus", params: {} }],
    });
    expect(result.mediaTypes.native?.template).toBe("<div>{{title}}</div>");
    expect(result.mediaTypes.native?.requiredAssets).toEqual(["title"]);
  });

  it("rejects native slot without template", () => {
    const registry = new ConfigRegistry();
    expect(() =>
      registry.register("slot_native_bad", {
        mediaTypes: { native: { requiredAssets: ["title"] } },
        bidders: [{ bidder: "appnexus", params: {} }],
      }),
    ).toThrow(ConfigError);
  });

  it("accepts a video slot config with optional player options", () => {
    const registry = new ConfigRegistry();
    const result = registry.register("slot_video", {
      mediaTypes: {
        video: {
          context: "outstream",
          playerSize: [640, 480],
          vastTimeoutMs: 8000,
          allowSkip: true,
        },
      },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
    });
    expect(result.mediaTypes.video?.context).toBe("outstream");
    expect(result.mediaTypes.video?.playerSize).toEqual([640, 480]);
    expect(result.mediaTypes.video?.vastTimeoutMs).toBe(8000);
  });

  it("rejects video config with non-number vastTimeoutMs", () => {
    const registry = new ConfigRegistry();
    expect(() =>
      registry.register("slot_bad_video", {
        mediaTypes: { video: { vastTimeoutMs: "soon" } },
        bidders: [{ bidder: "appnexus", params: {} }],
      }),
    ).toThrow(ConfigError);
  });

  it("accepts video config with plcmt + maxduration (#20)", () => {
    const registry = new ConfigRegistry();
    const result = registry.register("slot_video_plcmt", {
      mediaTypes: { video: { context: "outstream", plcmt: 4, maxduration: 30 } },
      bidders: [{ bidder: "pubmatic", params: {} }],
      eager: true,
    });
    expect(result.mediaTypes.video?.plcmt).toBe(4);
    expect(result.mediaTypes.video?.maxduration).toBe(30);
  });

  it("rejects video config with out-of-range plcmt (#20)", () => {
    const registry = new ConfigRegistry();
    expect(() =>
      registry.register("slot_bad_plcmt", {
        mediaTypes: { video: { plcmt: 5 } },
        bidders: [{ bidder: "pubmatic", params: {} }],
      }),
    ).toThrow(ConfigError);
  });

  it("rejects video config with non-positive maxduration (#20)", () => {
    const registry = new ConfigRegistry();
    expect(() =>
      registry.register("slot_bad_maxduration", {
        mediaTypes: { video: { maxduration: 0 } },
        bidders: [{ bidder: "pubmatic", params: {} }],
      }),
    ).toThrow(ConfigError);
  });

  it("accepts mixed banner + video on the same slot", () => {
    const registry = new ConfigRegistry();
    const result = registry.register("slot_mixed", {
      mediaTypes: {
        banner: { sizes: [[300, 250]] },
        video: { context: "outstream", playerSize: [640, 480] },
      },
      bidders: [{ bidder: "appnexus", params: {} }],
    });
    expect(result.mediaTypes.banner).toBeDefined();
    expect(result.mediaTypes.video).toBeDefined();
  });

  it("accepts valid per-mediaType refresh config with intervalSec >= 30", () => {
    const registry = new ConfigRegistry();
    const result = registry.register("slot_refresh", {
      mediaTypes: { banner: { sizes: [[300, 250]], refresh: { intervalSec: 30, sessionCap: 5 } } },
      bidders: [{ bidder: "appnexus", params: {} }],
    });
    expect(result.mediaTypes.banner?.refresh).toEqual({ intervalSec: 30, sessionCap: 5 });
  });

  it("accepts distinct refresh per mediaType — banner time-based, video sessionCap-only (D64/D66)", () => {
    const registry = new ConfigRegistry();
    const result = registry.register("slot_refresh_mixed", {
      mediaTypes: {
        banner: { sizes: [[300, 250]], refresh: { intervalSec: 30 } },
        video: { linearity: 1, refresh: { sessionCap: 3 } }, // ad-complete-driven, no intervalSec
      },
      bidders: [{ bidder: "appnexus", params: {} }],
    });
    expect(result.mediaTypes.banner?.refresh).toEqual({ intervalSec: 30 });
    expect(result.mediaTypes.video?.refresh).toEqual({ sessionCap: 3 });
  });

  it("rejects `intervalSec` on video refresh — video refreshes on ad-complete (D66)", () => {
    const registry = new ConfigRegistry();
    expect(() =>
      registry.register("slot_video_iv", {
        mediaTypes: { video: { linearity: 1, refresh: { intervalSec: 30, sessionCap: 3 } } },
        bidders: [{ bidder: "appnexus", params: {} }],
      }),
    ).toThrow(ConfigError);
  });

  it("accepts video refresh with sessionCap only (no intervalSec, D66)", () => {
    const registry = new ConfigRegistry();
    const result = registry.register("slot_video_cap", {
      mediaTypes: { video: { linearity: 1, refresh: { sessionCap: 5 } } },
      bidders: [{ bidder: "appnexus", params: {} }],
    });
    expect(result.mediaTypes.video?.refresh).toEqual({ sessionCap: 5 });
  });

  it("rejects mediaType refresh.intervalSec < 30 (IAB minimum)", () => {
    const registry = new ConfigRegistry();
    expect(() =>
      registry.register("slot_bad_refresh", {
        mediaTypes: { banner: { sizes: [[300, 250]], refresh: { intervalSec: 10 } } },
        bidders: [{ bidder: "appnexus", params: {} }],
      }),
    ).toThrow(ConfigError);
  });

  it("rejects mediaType refresh without intervalSec", () => {
    const registry = new ConfigRegistry();
    expect(() =>
      registry.register("slot_bad_refresh2", {
        mediaTypes: { banner: { sizes: [[300, 250]], refresh: {} } },
        bidders: [{ bidder: "appnexus", params: {} }],
      }),
    ).toThrow(ConfigError);
  });

  it("honors minRefreshIntervalSec for per-mediaType refresh", () => {
    const registry = new ConfigRegistry({ minRefreshIntervalSec: 5 });
    const result = registry.register("slot_min", {
      mediaTypes: { banner: { sizes: [[300, 250]], refresh: { intervalSec: 5 } } },
      bidders: [{ bidder: "appnexus", params: {} }],
    });
    expect(result.mediaTypes.banner?.refresh).toEqual({ intervalSec: 5 });
  });

  it("accepts optional eager flag; absence defaults to lazy", () => {
    const registry = new ConfigRegistry();
    const lazy = registry.register("slot_lazy_default", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: {} }],
    });
    expect(lazy.eager).toBeUndefined();

    const eager = registry.register("slot_eager_true", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: {} }],
      eager: true,
    });
    expect(eager.eager).toBe(true);

    expect(() =>
      registry.register("slot_bad_eager", {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: {} }],
        eager: "yes",
      }),
    ).toThrow(ConfigError);
  });

  it("accepts optional fallback image config with https url", () => {
    const registry = new ConfigRegistry();
    const result = registry.register("slot_fb", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [{ bidder: "appnexus", params: {} }],
      fallback: {
        type: "image",
        url: "https://cdn.example.com/house.png",
        clickUrl: "https://example.com/landing",
      },
    });

    expect(result.fallback).toEqual({
      type: "image",
      url: "https://cdn.example.com/house.png",
      clickUrl: "https://example.com/landing",
    });
  });

  it("rejects fallback with non-https url", () => {
    const registry = new ConfigRegistry();
    expect(() =>
      registry.register("slot_bad_fb", {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: {} }],
        fallback: { type: "image", url: "http://insecure.example.com/x.png" },
      }),
    ).toThrow(ConfigError);
  });

  it("rejects fallback missing url", () => {
    const registry = new ConfigRegistry();
    expect(() =>
      registry.register("slot_bad_fb2", {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: {} }],
        fallback: { type: "image" },
      }),
    ).toThrow(ConfigError);
  });

  it("re-registering the same slotId replaces the previous entry with a fresh object", () => {
    const registry = new ConfigRegistry();
    const baseConfig = {
      mediaTypes: { banner: { sizes: [[300, 250] as [number, number]] } },
      bidders: [{ bidder: "appnexus", params: { placementId: 1 } }],
    };

    const first = registry.register("slot_y", baseConfig);
    const second = registry.register("slot_y", baseConfig);

    expect(second).not.toBe(first);
    expect(registry.get("slot_y")).toBe(second);
  });

  it("get(slotId) returns the registered config and undefined for unknown ids", () => {
    const registry = new ConfigRegistry();
    const config = {
      mediaTypes: { banner: { sizes: [[300, 250] as [number, number]] } },
      bidders: [{ bidder: "appnexus", params: { placementId: 1 } }],
    };

    const registered = registry.register("slot_x", config);

    expect(registry.get("slot_x")).toBe(registered);
    expect(registry.get("unknown_slot")).toBeUndefined();
  });

  it("throws ConfigError when `bidders` is empty or missing", () => {
    const registry = new ConfigRegistry();

    expect(() =>
      registry.register("no_bidders", {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [],
      }),
    ).toThrow(ConfigError);

    expect(() =>
      registry.register("missing_bidders", {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
      }),
    ).toThrow(ConfigError);
  });

  it("throws ConfigError when banner sizes are not [w, h] pairs", () => {
    const registry = new ConfigRegistry();

    expect(() =>
      registry.register("bad_sizes", {
        mediaTypes: { banner: { sizes: [[300]] } },
        bidders: [{ bidder: "appnexus", params: {} }],
      }),
    ).toThrow(ConfigError);
  });
});
