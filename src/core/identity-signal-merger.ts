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
}

export interface MergeInput {
  readonly resolver: ResolverSignals | null;
  readonly prebidEids: ReadonlyArray<Eid>;
  readonly consent: ConsentSnapshot;
}

export function mergeIdentitySignals(input: MergeInput): Ortb2Patch {
  const { resolver, prebidEids, consent } = input;
  const regsExt: { gdpr?: 0 | 1; us_privacy?: string } = {
    gdpr: consent.tcfApplies ? 1 : 0,
  };
  const usp = consent.uspString ?? resolver?.regs?.ext?.us_privacy;
  if (usp !== undefined) regsExt.us_privacy = usp;

  if (consent.blocked) {
    return { user: { eids: [] }, regs: { ext: regsExt } };
  }

  const resolverEids = resolver?.eids ?? [];
  const resolverSources = new Set(resolverEids.map((e) => e.source));
  const prebidFiltered = prebidEids.filter((e) => !resolverSources.has(e.source));
  const user: { eids: ReadonlyArray<Eid>; buyeruid?: string } = {
    eids: [...resolverEids, ...prebidFiltered],
  };
  if (resolver?.buyeruid !== undefined) user.buyeruid = resolver.buyeruid;
  return { user, regs: { ext: regsExt } };
}
