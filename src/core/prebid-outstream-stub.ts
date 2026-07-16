/**
 * Prebid.js core rejects `mediaTypes.video` (outstream) at auction time unless an
 * ad-unit-level `renderer` is present — even though this SDK never calls a
 * renderer's `render()` (0 call sites in the vendored bundle). Real playback
 * always goes through `VideoRenderer`/IMA (D41), regardless of winning bidder.
 * This stub exists purely to satisfy that presence check. See
 * docs/adr/0009-inert-outstream-renderer-stub.md — do not delete as "unused".
 */
export const OUTSTREAM_RENDERER_STUB = {
  render: () => {},
};
