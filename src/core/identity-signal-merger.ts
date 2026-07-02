export interface Eid {
  readonly source: string;
  readonly uids: ReadonlyArray<{ readonly id: string }>;
}

export interface ResolverSignals {
  readonly eids?: ReadonlyArray<Eid>;
  readonly buyeruid?: string;
  readonly regs?: { readonly ext?: { readonly gdpr?: 0 | 1; readonly us_privacy?: string } };
  readonly user?: { readonly consent?: string };
}

export interface ConsentSnapshot {
  readonly blocked: boolean;
  readonly tcfApplies: boolean;
  readonly tcString?: string;
  readonly uspString?: string;
}

export interface Ortb2Patch {
  readonly user: {
    readonly eids?: ReadonlyArray<Eid>;
    readonly buyeruid?: string;
    readonly consent?: string;
  };
  readonly regs: { readonly ext: { readonly gdpr?: 0 | 1; readonly us_privacy?: string } };
  // Contextual first-party data (#5, D65). Carried in the per-auction patch so it
  // survives Prebid's setConfig({ortb2}) replace — otherwise the identity patch
  // would clobber the site pushed at init (verified: injected/publisher site.cat
  // and site.keywords vanished from the bid request whenever identity was active).
  readonly site?: Record<string, unknown>;
}

export interface MergeInput {
  readonly resolver: ResolverSignals | null;
  readonly prebidEids: ReadonlyArray<Eid>;
  readonly consent: ConsentSnapshot;
  // Publisher-injected identity (#1, D65) — authoritative first-party, so it wins
  // over the cookie-derived resolver / userId modules on a same-`source` conflict.
  readonly injectedEids?: ReadonlyArray<Eid>;
  readonly injectedBuyeruid?: string;
  // Contextual site FPD to carry in the patch (#5, D65).
  readonly site?: Record<string, unknown>;
}

export function mergeIdentitySignals(input: MergeInput): Ortb2Patch {
  const { resolver, prebidEids, consent, injectedEids, injectedBuyeruid, site } = input;
  const regsExt: { gdpr?: 0 | 1; us_privacy?: string } = {
    gdpr: consent.tcfApplies ? 1 : 0,
  };
  const usp = consent.uspString ?? resolver?.regs?.ext?.us_privacy;
  if (usp !== undefined) regsExt.us_privacy = usp;

  // Contextual site is not personal data — carry it regardless of consent so it
  // survives the per-auction ortb2 replace even when identity is blocked.
  const sitePatch = site ? { site } : {};

  if (consent.blocked) {
    return { user: { eids: [] }, regs: { ext: regsExt }, ...sitePatch };
  }

  // Precedence, highest first: injected (authoritative 1p) → resolver → prebid.
  // Each lower tier is filtered to drop sources an earlier tier already provided.
  const injected = injectedEids ?? [];
  const seen = new Set(injected.map((e) => e.source));
  const resolverEids = (resolver?.eids ?? []).filter((e) => !seen.has(e.source));
  resolverEids.forEach((e) => seen.add(e.source));
  const prebidFiltered = prebidEids.filter((e) => !seen.has(e.source));

  const user: { eids: ReadonlyArray<Eid>; buyeruid?: string } = {
    eids: [...injected, ...resolverEids, ...prebidFiltered],
  };
  const buyeruid = injectedBuyeruid ?? resolver?.buyeruid;
  if (buyeruid !== undefined) user.buyeruid = buyeruid;
  return { user, regs: { ext: regsExt }, ...sitePatch };
}
