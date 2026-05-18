import { ConfigError } from "./errors";

export interface IdentityConfig {
  readonly id5PartnerId?: number;
  readonly uid2?: { readonly email: string };
}

export interface ConsentLike {
  readonly blocked: boolean;
}

export interface UserIdEntry {
  readonly name: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly storage?: Readonly<Record<string, unknown>>;
}

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

function isSha256Hex(s: unknown): s is string {
  return typeof s === "string" && SHA256_HEX_RE.test(s);
}

export class IdentityResolver {
  constructor(private readonly opts: IdentityConfig) {
    if (opts.uid2 !== undefined) {
      if (!isSha256Hex(opts.uid2.email)) {
        throw new ConfigError("`identity.uid2.email` must be a 64-char lowercase SHA-256 hex", {
          field: "identity.uid2.email",
          value: opts.uid2.email,
        });
      }
    }
    if (opts.id5PartnerId !== undefined && typeof opts.id5PartnerId !== "number") {
      throw new ConfigError("`identity.id5PartnerId` must be a number", {
        field: "identity.id5PartnerId",
        value: opts.id5PartnerId,
      });
    }
  }

  buildUserIdsConfig(consent: ConsentLike): ReadonlyArray<UserIdEntry> {
    if (consent.blocked) return [];

    const userIds: UserIdEntry[] = [
      {
        name: "sharedId",
        storage: { type: "cookie", name: "_sharedid", expires: 365 },
      },
    ];

    if (typeof this.opts.id5PartnerId === "number") {
      userIds.push({
        name: "id5Id",
        params: { partner: this.opts.id5PartnerId },
        storage: { type: "cookie", name: "id5id", expires: 90 },
      });
    }

    if (this.opts.uid2 !== undefined) {
      userIds.push({
        name: "uid2",
        params: { email_hash: this.opts.uid2.email },
      });
    }

    return userIds;
  }
}
