import { resolveSizesForViewport } from "../src/core/resolve-sizes";

describe("resolveSizesForViewport", () => {
  it("returns flat array unchanged", () => {
    const sizes = [
      [300, 250],
      [728, 90],
    ] as ReadonlyArray<readonly [number, number]>;
    expect(resolveSizesForViewport(sizes, 1024)).toBe(sizes);
  });

  it("picks the matching `0-767` set when innerWidth=400", () => {
    const sizes = {
      "0-767": [[300, 250]] as ReadonlyArray<readonly [number, number]>,
      "768-1199": [[728, 90]] as ReadonlyArray<readonly [number, number]>,
      "1200+": [[970, 250]] as ReadonlyArray<readonly [number, number]>,
    };
    expect(resolveSizesForViewport(sizes, 400)).toEqual([[300, 250]]);
  });

  it("picks the matching `1200+` set when innerWidth=1500", () => {
    const sizes = {
      "0-767": [[300, 250]] as ReadonlyArray<readonly [number, number]>,
      "768-1199": [[728, 90]] as ReadonlyArray<readonly [number, number]>,
      "1200+": [
        [970, 250],
        [728, 90],
      ] as ReadonlyArray<readonly [number, number]>,
    };
    expect(resolveSizesForViewport(sizes, 1500)).toEqual([
      [970, 250],
      [728, 90],
    ]);
  });

  it("picks `768-1199` when innerWidth=1000", () => {
    const sizes = {
      "0-767": [[300, 250]] as ReadonlyArray<readonly [number, number]>,
      "768-1199": [[728, 90]] as ReadonlyArray<readonly [number, number]>,
      "1200+": [[970, 250]] as ReadonlyArray<readonly [number, number]>,
    };
    expect(resolveSizesForViewport(sizes, 1000)).toEqual([[728, 90]]);
  });
});
