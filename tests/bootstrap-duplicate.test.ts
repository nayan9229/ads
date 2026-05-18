import { bootstrap } from "../src/core/bootstrap";
import {
  installIntersectionObserverStub,
  uninstallIntersectionObserverStub,
} from "./helpers/iox-stub";

interface PbjsStub {
  que: Array<() => void>;
  setConfig: jest.Mock;
  addAdUnits: jest.Mock;
  requestBids: jest.Mock<
    void,
    [{ adUnitCodes: string[]; bidsBackHandler: (bids: unknown) => void }]
  >;
  getHighestCpmBids: jest.Mock;
  renderAd: jest.Mock<void, [Document, string]>;
}

function makePbjs(): PbjsStub {
  return {
    que: [],
    setConfig: jest.fn(),
    addAdUnits: jest.fn(),
    requestBids: jest.fn(({ bidsBackHandler }) => bidsBackHandler({})),
    getHighestCpmBids: jest
      .fn()
      .mockReturnValue([{ adId: "bid_x", width: 300, height: 250, cpm: 1 }]),
    renderAd: jest.fn(),
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  jest.advanceTimersByTime(50);
  await Promise.resolve();
}

describe("bootstrap — duplicate slotId handling", () => {
  let pbjs: PbjsStub;

  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    jest.useFakeTimers();
    installIntersectionObserverStub();
    pbjs = makePbjs();

    (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
      slot_dup: {
        mediaTypes: { banner: { sizes: [[300, 250]] } },
        bidders: [{ bidder: "appnexus", params: { placementId: 1 } }],
        eager: true,
      },
    };
  });
  afterEach(() => {
    jest.useRealTimers();
    uninstallIntersectionObserverStub();
    delete (window as { AdWrapper?: unknown }).AdWrapper;
  });

  it("re-registering an existing slotId destroys the prior container before injecting a new one", async () => {
    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      prebidLoaderOverride: () =>
        Promise.resolve(pbjs as unknown as import("../src/core/dependency-loader").PrebidGlobal),
      consentDisabled: true,
    });

    const wrapper = document.createElement("section");
    const script1 = document.createElement("script");
    script1.id = "slot_dup";
    wrapper.appendChild(script1);
    document.body.appendChild(wrapper);

    const reg1 = api.registerScript(script1);
    await flush();
    await reg1;

    expect(document.querySelectorAll('[data-adwrapper-slot="slot_dup"]')).toHaveLength(1);

    const script2 = document.createElement("script");
    script2.id = "slot_dup";
    wrapper.appendChild(script2);

    const reg2 = api.registerScript(script2);
    await flush();
    await reg2;

    expect(document.querySelectorAll('[data-adwrapper-slot="slot_dup"]')).toHaveLength(1);
  });
});
