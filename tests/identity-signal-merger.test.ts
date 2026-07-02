import { mergeIdentitySignals } from "../src/core/identity-signal-merger";

describe("mergeIdentitySignals", () => {
  it("unions resolver and Prebid eids when their source URIs do not overlap", () => {
    const out = mergeIdentitySignals({
      resolver: {
        eids: [{ source: "id5-sync.com", uids: [{ id: "id5-abc" }] }],
      },
      prebidEids: [{ source: "pubcid.org", uids: [{ id: "pubcid-xyz" }] }],
      consent: { blocked: false, tcfApplies: false },
    });

    const sources = out.user.eids?.map((e) => e.source) ?? [];
    expect(sources).toEqual(expect.arrayContaining(["id5-sync.com", "pubcid.org"]));
    expect(sources).toHaveLength(2);
  });

  it("injected eids win over resolver on a same-source conflict (#1/D65)", () => {
    const out = mergeIdentitySignals({
      resolver: { eids: [{ source: "id5-sync.com", uids: [{ id: "resolver-id5" }] }] },
      prebidEids: [{ source: "id5-sync.com", uids: [{ id: "prebid-id5" }] }],
      injectedEids: [{ source: "id5-sync.com", uids: [{ id: "injected-id5" }] }],
      consent: { blocked: false, tcfApplies: false },
    });
    const id5 = out.user.eids?.filter((e) => e.source === "id5-sync.com") ?? [];
    expect(id5).toHaveLength(1); // deduped by source
    expect(id5[0]?.uids[0]?.id).toBe("injected-id5"); // authoritative 1p wins
  });

  it("unions injected + resolver + prebid across distinct sources (injected first)", () => {
    const out = mergeIdentitySignals({
      resolver: { eids: [{ source: "id5-sync.com", uids: [{ id: "r" }] }] },
      prebidEids: [{ source: "pubcid.org", uids: [{ id: "p" }] }],
      injectedEids: [{ source: "uidapi.com", uids: [{ id: "i" }] }],
      consent: { blocked: false, tcfApplies: false },
    });
    expect(out.user.eids?.map((e) => e.source)).toEqual(["uidapi.com", "id5-sync.com", "pubcid.org"]);
  });

  it("injected buyeruid wins over resolver buyeruid", () => {
    const out = mergeIdentitySignals({
      resolver: { buyeruid: "resolver-buyer" },
      prebidEids: [],
      injectedBuyeruid: "injected-buyer",
      consent: { blocked: false, tcfApplies: false },
    });
    expect(out.user.buyeruid).toBe("injected-buyer");
  });

  it("drops injected eids too when consent is blocked", () => {
    const out = mergeIdentitySignals({
      resolver: null,
      prebidEids: [],
      injectedEids: [{ source: "uidapi.com", uids: [{ id: "i" }] }],
      consent: { blocked: true, tcfApplies: true },
    });
    expect(out.user.eids).toEqual([]);
  });

  it("ConsentManager uspString wins over resolver.regs.ext.us_privacy", () => {
    const out = mergeIdentitySignals({
      resolver: { regs: { ext: { us_privacy: "1YYY" } } },
      prebidEids: [],
      consent: { blocked: false, tcfApplies: false, uspString: "1NNN" },
    });
    expect(out.regs.ext.us_privacy).toBe("1NNN");
  });

  it("falls back to resolver.regs.ext.us_privacy when ConsentManager uspString is absent", () => {
    const out = mergeIdentitySignals({
      resolver: { regs: { ext: { us_privacy: "1YYY" } } },
      prebidEids: [],
      consent: { blocked: false, tcfApplies: false },
    });
    expect(out.regs.ext.us_privacy).toBe("1YYY");
  });

  it("emits regs.ext.gdpr === 1 when tcfApplies and not blocked", () => {
    const out = mergeIdentitySignals({
      resolver: null,
      prebidEids: [],
      consent: { blocked: false, tcfApplies: true },
    });
    expect(out.regs.ext.gdpr).toBe(1);
  });

  it("emits regs.ext.gdpr === 0 when tcfApplies is false", () => {
    const out = mergeIdentitySignals({
      resolver: null,
      prebidEids: [],
      consent: { blocked: false, tcfApplies: false },
    });
    expect(out.regs.ext.gdpr).toBe(0);
  });

  it("falls back to Prebid-only eids when resolver is null (load failure)", () => {
    const out = mergeIdentitySignals({
      resolver: null,
      prebidEids: [{ source: "pubcid.org", uids: [{ id: "pubcid-xyz" }] }],
      consent: { blocked: false, tcfApplies: false },
    });

    expect(out.user.eids).toEqual([{ source: "pubcid.org", uids: [{ id: "pubcid-xyz" }] }]);
    expect(out.user.buyeruid).toBeUndefined();
  });

  it("strips user.eids and user.buyeruid when consent is blocked but keeps regs.ext.gdpr", () => {
    const out = mergeIdentitySignals({
      resolver: {
        eids: [{ source: "id5-sync.com", uids: [{ id: "id5-abc" }] }],
        buyeruid: "buyer-123",
      },
      prebidEids: [{ source: "pubcid.org", uids: [{ id: "pubcid-xyz" }] }],
      consent: { blocked: true, tcfApplies: true },
    });

    expect(out.user.eids).toEqual([]);
    expect(out.user.buyeruid).toBeUndefined();
    expect(out.regs.ext.gdpr).toBe(1);
  });

  it("prefers resolver eids over Prebid eids when both emit the same source URI", () => {
    const out = mergeIdentitySignals({
      resolver: {
        eids: [{ source: "id5-sync.com", uids: [{ id: "resolver-wins" }] }],
      },
      prebidEids: [{ source: "id5-sync.com", uids: [{ id: "prebid-loses" }] }],
      consent: { blocked: false, tcfApplies: false },
    });

    const id5 = out.user.eids?.find((e) => e.source === "id5-sync.com");
    expect(id5?.uids[0]?.id).toBe("resolver-wins");
    expect(out.user.eids).toHaveLength(1);
  });
});
