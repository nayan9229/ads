import { BidderParamResolver } from "../src/core/bidder-param-resolver";

describe("BidderParamResolver", () => {
  it("returns env-substituted params for a known bidder", () => {
    const resolver = new BidderParamResolver({
      env: { ADW_APPNEXUS_PLACEMENT_ID: "13144370" },
    });
    const out = resolver.real("appnexus", { placementId: -1 });
    expect(out).toEqual({ placementId: "13144370" });
  });

  it("returns the mock fallback unchanged when env keys are missing", () => {
    const resolver = new BidderParamResolver({ env: {} });
    const mock = { placementId: -1, debug: true };
    expect(resolver.real("appnexus", mock)).toBe(mock);
  });

  it("returns the mock fallback unchanged for an unknown bidder name", () => {
    const resolver = new BidderParamResolver({
      env: { ADW_APPNEXUS_PLACEMENT_ID: "999" },
    });
    const mock = { custom: 1 };
    expect(resolver.real("not-a-real-bidder", mock)).toBe(mock);
  });
});
