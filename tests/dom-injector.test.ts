import { DomInjector } from "../src/dom/dom-injector";

describe("DomInjector", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("inserts a sibling div after the script tag, at reserved size, marked with slot id", () => {
    const wrapper = document.createElement("section");
    const script = document.createElement("script");
    script.id = "homepage_300x250_top";
    wrapper.appendChild(script);
    document.body.appendChild(wrapper);

    const injector = new DomInjector();
    const container = injector.inject({
      scriptEl: script,
      slotId: "homepage_300x250_top",
      reserved: [300, 250],
    });

    expect(container.tagName).toBe("DIV");
    expect(container.parentElement).toBe(wrapper);
    expect(script.nextElementSibling).toBe(container);
    expect(container.dataset.adwrapperSlot).toBe("homepage_300x250_top");
    expect(container.style.width).toBe("300px");
    expect(container.style.height).toBe("250px");
  });

  it("falls back to getElementById when scriptEl is null (async/defer-style)", () => {
    const wrapper = document.createElement("section");
    const script = document.createElement("script");
    script.id = "lazy_slot";
    wrapper.appendChild(script);
    document.body.appendChild(wrapper);

    const injector = new DomInjector();
    const container = injector.inject({
      scriptEl: null,
      slotId: "lazy_slot",
      reserved: [728, 90],
    });

    expect(script.nextElementSibling).toBe(container);
  });
});
