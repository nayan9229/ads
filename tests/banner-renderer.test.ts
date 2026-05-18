import { BannerRenderer } from "../src/renderers/banner-renderer";
import { CallbackRegistry } from "../src/core/callback-registry";
import { ErrorRegistry } from "../src/core/error-registry";

interface PbjsStub {
  renderAd: jest.Mock<void, [Document, string]>;
}

describe("BannerRenderer", () => {
  let pbjs: PbjsStub;

  beforeEach(() => {
    document.body.innerHTML = "";
    pbjs = { renderAd: jest.fn() };
  });

  it("creates a fresh iframe inside the container and calls pbjs.renderAd with it", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const renderer = new BannerRenderer(
      pbjs as unknown as { renderAd: (doc: Document, adId: string) => void },
      new CallbackRegistry(new ErrorRegistry()),
    );

    renderer.render({
      container,
      bid: { adId: "bid_xyz", width: 300, height: 250 },
      slotId: "homepage_300x250_top",
    });

    const iframe = container.querySelector("iframe") as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    expect(iframe!.width).toBe("300");
    expect(iframe!.height).toBe("250");
    expect(pbjs.renderAd).toHaveBeenCalledWith(iframe!.contentDocument, "bid_xyz");
  });

  it("emits adRenderSuccess with slotId, adId, and size after render", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const seen: unknown[] = [];
    callbacks.on("adRenderSuccess", (p) => seen.push(p));

    const renderer = new BannerRenderer(
      pbjs as unknown as { renderAd: (doc: Document, adId: string) => void },
      callbacks,
    );

    renderer.render({
      container,
      bid: { adId: "bid_xyz", width: 728, height: 90 },
      slotId: "leaderboard_top",
    });

    expect(seen).toEqual([{ slotId: "leaderboard_top", adId: "bid_xyz", size: [728, 90] }]);
  });
});
