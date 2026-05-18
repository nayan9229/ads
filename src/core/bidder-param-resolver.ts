export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface BidderParamResolverOptions {
  readonly env: EnvSource;
}

interface BidderRule {
  readonly envKeys: ReadonlyArray<string>;
  readonly build: (vals: ReadonlyArray<string>) => Record<string, unknown>;
}

const RULES: Readonly<Record<string, BidderRule>> = {
  appnexus: {
    envKeys: ["ADW_APPNEXUS_PLACEMENT_ID"],
    build: ([placementId]) => ({ placementId }),
  },
  rubicon: {
    envKeys: ["ADW_RUBICON_ACCOUNT_ID", "ADW_RUBICON_SITE_ID", "ADW_RUBICON_ZONE_ID"],
    build: ([accountId, siteId, zoneId]) => ({ accountId, siteId, zoneId }),
  },
  ix: {
    envKeys: ["ADW_IX_SITE_ID", "ADW_IX_SIZE"],
    build: ([siteId, size]) => ({ siteId, size }),
  },
  openx: {
    envKeys: ["ADW_OPENX_UNIT", "ADW_OPENX_DELDOMAIN"],
    build: ([unit, delDomain]) => ({ unit, delDomain }),
  },
  pubmatic: {
    envKeys: ["ADW_PUBMATIC_PUB_ID", "ADW_PUBMATIC_AD_SLOT"],
    build: ([publisherId, adSlot]) => ({ publisherId, adSlot }),
  },
  triplelift: {
    envKeys: ["ADW_TRIPLELIFT_INVENTORY_CODE"],
    build: ([inventoryCode]) => ({ inventoryCode }),
  },
};

export class BidderParamResolver {
  constructor(private readonly opts: BidderParamResolverOptions) {}

  real(name: string, mockFallback: Record<string, unknown>): Record<string, unknown> {
    const rule = RULES[name];
    if (!rule) return mockFallback;

    const values: string[] = [];
    for (const key of rule.envKeys) {
      const v = this.opts.env[key];
      if (typeof v !== "string" || v.length === 0) return mockFallback;
      values.push(v);
    }
    return rule.build(values);
  }
}
