# Bidder Setup

The SDK ships with the v1 locked bidder set (CONTEXT D8): **AppNexus**, **Rubicon**, **IX**, **OpenX**, **PubMatic**, **TripleLift**. Each publisher brings their own bidder accounts (BYO seats — CONTEXT D37).

This document lists the required and optional `params` for each bidder.

> **HITL gate**: Real-bidder credentials are provisioned by humans. The CI pipeline does **not** ship credentials by default — publishers add their own GitHub Actions secrets when they need the nightly `?real=1` Playwright run (see [`releases.md`](./releases.md)).

---

## Environment-variable shape

The demo's `?real=1` mode reads from a build-time-substituted env map. Variable names are uppercase and prefixed with `ADW_`.

| Bidder     | Env keys                                                               | Notes                                                                                          |
| ---------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| AppNexus   | `ADW_APPNEXUS_PLACEMENT_ID`                                            | Single placement ID per slot. Source: Xandr Console → Inventory → Placements.                  |
| Rubicon    | `ADW_RUBICON_ACCOUNT_ID`, `ADW_RUBICON_SITE_ID`, `ADW_RUBICON_ZONE_ID` | All three numbers. Source: Magnite Connect → My Inventory.                                     |
| IX         | `ADW_IX_SITE_ID`, `ADW_IX_SIZE`                                        | `siteId` numeric; `size` like `"300x250"`. Source: Index Exchange Console → Setup → Mediation. |
| OpenX      | `ADW_OPENX_UNIT`, `ADW_OPENX_DELDOMAIN`                                | `unit` numeric. `delDomain` looks like `acme-d.openx.net`.                                     |
| PubMatic   | `ADW_PUBMATIC_PUB_ID`, `ADW_PUBMATIC_AD_SLOT`                          | `adSlot` typically `1234@300x250`.                                                             |
| TripleLift | `ADW_TRIPLELIFT_INVENTORY_CODE`                                        | Inventory code from TL onboarding.                                                             |

Missing any required env key for a bidder causes the resolver to fall back to the slot's mock params — production builds without all credentials will still boot, but that bidder won't have a real seat.

---

## Per-bidder params (Prebid schema)

### AppNexus

```js
{ bidder: "appnexus", params: { placementId: 13144370 } }
```

Optional: `keywords`, `usePaymentRule`, `customFloor`.

### Rubicon

```js
{
  bidder: "rubicon",
  params: { accountId: 1001, siteId: 113932, zoneId: 535510 },
}
```

Optional: `inventory`, `visitor`, `position`.

### IX

```js
{ bidder: "ix", params: { siteId: "12345", size: [300, 250] } }
```

Both fields are required. `size` can be `[w, h]` array or `"WxH"` string.

### OpenX

```js
{
  bidder: "openx",
  params: { unit: "987654321", delDomain: "acme-d.openx.net" },
}
```

Optional: `customFloor`, `customParams`.

### PubMatic

```js
{
  bidder: "pubmatic",
  params: { publisherId: "12345", adSlot: "12345@300x250" },
}
```

Optional: `pmzoneid`, `kadfloor`.

### TripleLift

```js
{ bidder: "triplelift", params: { inventoryCode: "site_native_card" } }
```

Optional: `floor`.

---

## Onboarding checklist (per bidder)

1. Sign the bidder contract / open the account.
2. Get the placement ID(s) for each slot from the bidder's console.
3. Add the env values to GitHub Actions secrets under `ADW_*` names.
4. (Optional) Verify on staging by visiting the demo with `?real=1`.
5. Confirm bid request reaches the bidder via the bidder's reporting dashboard.

---

## Mock vs real switch

In code, the demo uses `BidderParamResolver` to switch between mock and real params at runtime:

```ts
const resolver = new BidderParamResolver({ env: window.__ADW_BIDDER_ENV ?? {} });
const params = wantsReal ? resolver.real("appnexus", { placementId: 1 }) : { placementId: 1 };
```

`window.__ADW_BIDDER_ENV` is populated at build time from `process.env.ADW_*` values when the demo bundle is built with credentials available.
