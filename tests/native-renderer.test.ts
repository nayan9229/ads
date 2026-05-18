import { NativeRenderer } from "../src/renderers/native-renderer";
import { CallbackRegistry } from "../src/core/callback-registry";
import { ErrorRegistry } from "../src/core/error-registry";

const SIMPLE_TEMPLATE = `
<div class="card">
  <img class="img" data-asset="image" alt="" />
  <h3 class="title">{{title}}</h3>
  <p class="body">{{body}}</p>
  <a class="cta" data-asset="clickUrl">{{cta}}</a>
  <span class="sponsor">{{sponsoredBy}}</span>
</div>`.trim();

function makeBid(overrides: Record<string, unknown> = {}) {
  return {
    adId: "native_bid_1",
    native: {
      title: "Try Foo",
      body: "Foo solves bar.",
      cta: "Learn more",
      sponsoredBy: "FooCo",
      image: { url: "https://cdn.example.com/img.png" },
      clickUrl: "https://example.com/foo",
      clickTrackers: [] as string[],
      impressionTrackers: [] as string[],
      ...overrides,
    },
  };
}

describe("NativeRenderer", () => {
  let callbacks: CallbackRegistry;

  beforeEach(() => {
    document.body.innerHTML = "";
    callbacks = new CallbackRegistry(new ErrorRegistry());
  });

  it("substitutes text placeholders into container via textContent", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const renderer = new NativeRenderer(callbacks);
    renderer.render({
      container,
      bid: makeBid(),
      slotId: "slot_n",
      template: SIMPLE_TEMPLATE,
      requiredAssets: ["title"],
    });

    expect(container.querySelector(".title")?.textContent).toBe("Try Foo");
    expect(container.querySelector(".body")?.textContent).toBe("Foo solves bar.");
    expect(container.querySelector(".cta")?.textContent).toBe("Learn more");
    expect(container.querySelector(".sponsor")?.textContent).toBe("FooCo");
  });

  it("renders <script> in asset as literal text, not as a script element", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const renderer = new NativeRenderer(callbacks);
    renderer.render({
      container,
      bid: makeBid({ title: "<script>window.__xss=true</script>Pwned" }),
      slotId: "slot_xss",
      template: SIMPLE_TEMPLATE,
      requiredAssets: ["title"],
    });

    expect(container.querySelector("script")).toBeNull();
    expect((window as unknown as { __xss?: boolean }).__xss).toBeUndefined();
    expect(container.querySelector(".title")?.textContent).toBe(
      "<script>window.__xss=true</script>Pwned",
    );
  });

  it("rejects bid with non-HTTPS image URL; fires adRenderFail and returns false", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const events: unknown[] = [];
    callbacks.on("adRenderFail", (p) => events.push(p));

    const renderer = new NativeRenderer(callbacks);
    const ok = renderer.render({
      container,
      bid: makeBid({ image: { url: "http://insecure.example.com/img.png" } }),
      slotId: "slot_http",
      template: SIMPLE_TEMPLATE,
      requiredAssets: ["title", "image"],
    });

    expect(ok).toBe(false);
    expect(container.children).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ slotId: "slot_http" });
  });

  it("rejects bid whose clickUrl is non-HTTPS or javascript:", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const renderer = new NativeRenderer(callbacks);

    const ok1 = renderer.render({
      container,
      bid: makeBid({ clickUrl: "javascript:alert(1)" }),
      slotId: "slot_jsurl",
      template: SIMPLE_TEMPLATE,
      requiredAssets: ["title"],
    });
    expect(ok1).toBe(false);
    expect(container.children).toHaveLength(0);

    const ok2 = renderer.render({
      container,
      bid: makeBid({ clickUrl: "http://insecure.example.com/x" }),
      slotId: "slot_httpurl",
      template: SIMPLE_TEMPLATE,
      requiredAssets: ["title"],
    });
    expect(ok2).toBe(false);
  });

  it("rejects bid missing a required asset", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const events: unknown[] = [];
    callbacks.on("adRenderFail", (p) => events.push(p));

    const renderer = new NativeRenderer(callbacks);
    const ok = renderer.render({
      container,
      bid: makeBid({ title: undefined }),
      slotId: "slot_missing",
      template: SIMPLE_TEMPLATE,
      requiredAssets: ["title", "body"],
    });

    expect(ok).toBe(false);
    expect(events).toHaveLength(1);
  });

  it("fires each clickTrackers URL via Image() on click", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const createdImageSrcs: string[] = [];
    const RealImage = window.Image;
    function FakeImage(this: { src: string }) {
      Object.defineProperty(this, "src", {
        set(v: string) {
          createdImageSrcs.push(v);
        },
        get() {
          return "";
        },
        configurable: true,
      });
    }
    (window as unknown as { Image: typeof Image }).Image = FakeImage as unknown as typeof Image;

    try {
      const renderer = new NativeRenderer(callbacks);
      renderer.render({
        container,
        bid: makeBid({
          clickTrackers: ["https://t1.example.com/click", "https://t2.example.com/click"],
        }),
        slotId: "slot_click",
        template: SIMPLE_TEMPLATE,
        requiredAssets: ["title"],
      });

      const root = container.firstElementChild as HTMLElement;
      root.click();

      expect(createdImageSrcs).toEqual([
        "https://t1.example.com/click",
        "https://t2.example.com/click",
      ]);
    } finally {
      (window as unknown as { Image: typeof Image }).Image = RealImage;
    }
  });

  it("fires each impressionTrackers URL via Image() on render", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const createdImageSrcs: string[] = [];
    const RealImage = window.Image;
    function FakeImage(this: { src: string }) {
      Object.defineProperty(this, "src", {
        set(v: string) {
          createdImageSrcs.push(v);
        },
        get() {
          return "";
        },
        configurable: true,
      });
    }
    (window as unknown as { Image: typeof Image }).Image = FakeImage as unknown as typeof Image;

    try {
      const renderer = new NativeRenderer(callbacks);
      renderer.render({
        container,
        bid: makeBid({
          impressionTrackers: ["https://imp1.example.com/i", "https://imp2.example.com/i"],
        }),
        slotId: "slot_imp",
        template: SIMPLE_TEMPLATE,
        requiredAssets: ["title"],
      });

      expect(createdImageSrcs).toEqual([
        "https://imp1.example.com/i",
        "https://imp2.example.com/i",
      ]);
    } finally {
      (window as unknown as { Image: typeof Image }).Image = RealImage;
    }
  });
});
