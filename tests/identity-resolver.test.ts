import { IdentityResolver } from "../src/core/identity-resolver";
import { ConfigError } from "../src/core/errors";

describe("IdentityResolver", () => {
  it("always includes sharedId in the userIds array (default config)", () => {
    const resolver = new IdentityResolver({});

    const userIds = resolver.buildUserIdsConfig({ blocked: false });

    const names = userIds.map((u) => u.name);
    expect(names).toContain("sharedId");
  });

  it("populates id5Id entry with params.partner when id5PartnerId provided", () => {
    const resolver = new IdentityResolver({ id5PartnerId: 1234 });
    const userIds = resolver.buildUserIdsConfig({ blocked: false });

    const id5 = userIds.find((u) => u.name === "id5Id");
    expect(id5).toBeDefined();
    expect(id5!.params).toEqual({ partner: 1234 });
  });

  it("populates uid2 entry with email_hash when a valid SHA-256 hex provided", () => {
    const validHash = "a".repeat(64);
    const resolver = new IdentityResolver({ uid2: { email: validHash } });
    const userIds = resolver.buildUserIdsConfig({ blocked: false });

    const uid2 = userIds.find((u) => u.name === "uid2");
    expect(uid2).toBeDefined();
    expect(uid2!.params).toEqual({ email_hash: validHash });
  });

  it("rejects invalid hashed email (wrong length or non-hex)", () => {
    expect(() => new IdentityResolver({ uid2: { email: "abc" } })).toThrow(ConfigError);
    expect(() => new IdentityResolver({ uid2: { email: "Z".repeat(64) } })).toThrow(ConfigError);
    expect(() => new IdentityResolver({ uid2: { email: "a".repeat(63) } })).toThrow(ConfigError);
  });

  it("returns an empty userIds array when consent is blocked", () => {
    const resolver = new IdentityResolver({
      id5PartnerId: 1234,
      uid2: { email: "a".repeat(64) },
    });
    expect(resolver.buildUserIdsConfig({ blocked: true })).toEqual([]);
  });
});
