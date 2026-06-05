# Explicit `registerSlot(slotId, containerEl)` for Shadow-DOM hosts (don't auto-detect)

## Context

The SDK boots via a self-executing `<script>` tag per slot (D6). `src/index.ts` derives the slot anchor from `document.currentScript`, then sibling-injects the ad container next to it. D53 added an opt-in `config.container` *string* (element ID) resolved with `document.getElementById`.

A host app renders its ad surfaces inside an open Shadow DOM (`attachShadow({ mode: "open" })`), with the container built later in a framework mount hook. Two browser facts break the existing model in this environment:

1. **`document.currentScript` is null for shadow-rooted scripts.** Per the HTML spec's "execute the script element" algorithm, `currentScript` is set to the element only when the script's root is *not* a shadow root. A `<script>` placed inside a shadow root therefore never reaches `api.registerScript(me)` in `index.ts` — the SDK never boots for that slot.
2. **`getElementById` / `getRootNode()` can't cross into the container's tree.** When the slot tag lives in the main document (so `currentScript` works) but the container lives in a shadow root, `document.getElementById(config.container)` returns null and `scriptEl.getRootNode()` resolves the *script's* root (the document), not the container's. A document-level `MutationObserver` also cannot observe mutations inside a shadow tree, so the SDK cannot wait for a late-mounted shadow container either.

The originally-proposed fix (`scriptEl.getRootNode().getElementById(...)` in `bootstrap.ts` and `dom-injector.ts`) was based on a misdiagnosis: it assumes the script and container share a tree. They don't. It is a no-op in the real setup, and the `dom-injector.ts` arm is dead code (only reached when `scriptEl` is null, where it already falls back to `document`).

## Decision

**Add an explicit host-driven entry point; do not auto-detect or walk the DOM.**

```ts
registerSlot(slotId: string, containerEl: HTMLElement): Promise<void>
```

The host calls it from its mount hook, when the container provably exists. The element travels as a method argument and is used directly as the ad surface — no `getElementById`, no shadow-root traversal, no timing race.

Behaviour mirrors `registerScript`:

- Reads `AdWrapperConfig[slotId]`; throws `ConfigError("no config for slot")` if absent.
- Treats `containerEl` as a publisher-owned surface: tracked in `publisherContainers`, so `destroy(slotId)` clears `innerHTML` rather than `remove()` (D53). No inline width/height/display styles applied.
- Idempotent on re-mount: `destroy(slotId)` first if a lifecycle exists (D26 SPA cleanup).
- Joins the same 50 ms batched-auction queue (D29).
- Throws `TypeError` on a non-`Element` `containerEl` (programmer error, D20).

`registerScript` and `registerSlot` share one private tail (reserved-size calc → `DomInjector.inject` → `getPbjs` → renderers → `SlotLifecycle` → orchestrator), differing only in how they obtain `slotId` and the surface. `config.container` (string) and its registry validation are unchanged; the config registry never holds a DOM handle.

## Considered alternatives

- **`scriptEl.getRootNode().getElementById(...)` two-liner** (the original plan) — rejected: `getRootNode()` resolves the script's tree, not the container's; a no-op when the script is in the main document and the container is shadow-rooted, and unreachable when the script is shadow-rooted (`currentScript` null).
- **SDK walks open shadow roots** (`deepGetById` recursive descent) — rejected: open-only (can't see closed roots), ID-ambiguous across roots, O(n) per slot, and — fatally — the container is built *after* the synchronous walk runs, with no observable cross-boundary signal to retry on. Degrades to polling-until-timeout, recreating the exact failure being fixed.
- **Overload `config.container` to accept an `HTMLElement`** — rejected: breaks the config-registry validator (`container` must be a non-empty string, `config-registry.ts:409`), contradicts D53 and the "config set inline above the tag, keyed by slot ID" delivery model, and an element handle can't exist inline before mount — so it *still* requires a trigger call while corrupting the schema.

## Consequences

- New public API surface (`registerSlot`) — hard to reverse once published; must be maintained at least one major version.
- Shadow-DOM hosts opt in with one explicit call; the main-document auto-init path (D6) is untouched and pays nothing.
- Only **open** shadow roots are supported. Closed roots are out of scope — the SDK cannot reach a root it didn't create; the host must pass the element (which `registerSlot` already requires anyway).
- The current `position: fixed` / append-to-`document.body` workaround can be removed by hosts once they migrate to `registerSlot`.
