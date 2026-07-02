import { readInjectedSignals } from "../src/core/injected-signals";

function b64url(obj: unknown): string {
  const b64 = Buffer.from(JSON.stringify(obj)).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("readInjectedSignals", () => {
  it("returns empty when nothing is injected", () => {
    expect(readInjectedSignals({})).toEqual({ eids: [] });
    expect(readInjectedSignals(undefined)).toEqual({ eids: [] });
  });

  it("reads eids array + buyeruid + site from window.AdWrapperIdentity", () => {
    const win = {
      AdWrapperIdentity: {
        eids: [{ source: "id5-sync.com", uids: [{ id: "ID5-xyz" }] }],
        buyeruid: "buyer-1",
        page: "https://pub.example/article",
        cat: ["IAB1", "IAB2"],
        keywords: "sports,news",
        content: { language: "en" },
      },
    };
    const out = readInjectedSignals(win);
    expect(out.eids).toEqual([{ source: "id5-sync.com", uids: [{ id: "ID5-xyz" }] }]);
    expect(out.buyeruid).toBe("buyer-1");
    expect(out.site).toEqual({
      page: "https://pub.example/article",
      cat: ["IAB1", "IAB2"],
      keywords: "sports,news",
      content: { language: "en" },
    });
  });

  it("maps named shortcuts (uid2/id5/ramp) to canonical eid sources", () => {
    const win = { AdWrapperIdentity: { uid2: "UID2token", id5: "ID5val", ramp: "RampId" } };
    const out = readInjectedSignals(win);
    expect(out.eids).toEqual([
      { source: "uidapi.com", uids: [{ id: "UID2token" }] },
      { source: "id5-sync.com", uids: [{ id: "ID5val" }] },
      { source: "liveramp.com", uids: [{ id: "RampId" }] },
    ]);
  });

  it("decodes eids from a base64url JSON script-URL param, and cat from CSV", () => {
    const eids = [{ source: "uidapi.com", uids: [{ id: "abc" }] }];
    const win = {
      document: {
        currentScript: { src: `https://cdn/gen_ad.min.js?eids=${b64url(eids)}&cat=IAB1,IAB9&page=https%3A%2F%2Fp.co%2Fx` },
      },
    };
    const out = readInjectedSignals(win);
    expect(out.eids).toEqual(eids);
    expect(out.site?.cat).toEqual(["IAB1", "IAB9"]);
    expect(out.site?.page).toBe("https://p.co/x");
  });

  it("applies precedence: $sf.ext.meta() over global over script-URL", () => {
    const win = {
      $sf: { ext: { meta: () => ({ adw: { buyeruid: "from-meta" } }) } },
      AdWrapperIdentity: { buyeruid: "from-global", uid2: "u1" },
      document: { currentScript: { src: "https://cdn/gen_ad.min.js?buyeruid=from-url" } },
    };
    const out = readInjectedSignals(win);
    expect(out.buyeruid).toBe("from-meta"); // meta wins for buyeruid
    // fields not present in meta fall through to the next layer
    expect(out.eids).toEqual([{ source: "uidapi.com", uids: [{ id: "u1" }] }]);
  });

  it("drops malformed eids and never throws", () => {
    const win = {
      AdWrapperIdentity: {
        eids: [
          { source: "ok.com", uids: [{ id: "good" }] },
          { source: "", uids: [{ id: "x" }] }, // empty source
          { source: "nouids.com" }, // no uids
          { source: "emptyuids.com", uids: [] }, // empty uids
          "not-an-object",
        ],
      },
    };
    const out = readInjectedSignals(win);
    expect(out.eids).toEqual([{ source: "ok.com", uids: [{ id: "good" }] }]);
  });

  it("returns empty eids for an undecodable base64 eids param without throwing", () => {
    const win = { document: { currentScript: { src: "https://cdn/gen_ad.min.js?eids=%%NOT_B64%%" } } };
    expect(() => readInjectedSignals(win)).not.toThrow();
    expect(readInjectedSignals(win).eids).toEqual([]);
  });
});
