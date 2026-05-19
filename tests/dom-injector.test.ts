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

  describe("explicit containerEl (D53)", () => {
    it("uses the provided element directly without injecting a sibling", () => {
      const wrapper = document.createElement("section");
      const script = document.createElement("script");
      script.id = "slot_explicit";
      const existingDiv = document.createElement("div");
      existingDiv.id = "my-ad-container";
      wrapper.appendChild(script);
      wrapper.appendChild(existingDiv);
      document.body.appendChild(wrapper);

      const injector = new DomInjector();
      const container = injector.inject({
        scriptEl: script,
        slotId: "slot_explicit",
        reserved: [300, 250],
        containerEl: existingDiv,
      });

      expect(container).toBe(existingDiv);
      expect(container.dataset.adwrapperSlot).toBe("slot_explicit");
    });

    it("does not apply inline width/height/display styles to the provided element", () => {
      const el = document.createElement("div");
      el.id = "publisher-owned";
      document.body.appendChild(el);

      const injector = new DomInjector();
      injector.inject({
        scriptEl: null,
        slotId: "slot_no_size",
        reserved: [300, 250],
        containerEl: el,
      });

      expect(el.style.width).toBe("");
      expect(el.style.height).toBe("");
      expect(el.style.display).toBe("");
    });

    it("does not insert any additional sibling elements when containerEl is provided", () => {
      const wrapper = document.createElement("section");
      const script = document.createElement("script");
      script.id = "slot_no_sibling";
      const existingDiv = document.createElement("div");
      wrapper.appendChild(script);
      document.body.appendChild(wrapper);

      const initialChildCount = wrapper.children.length;
      const injector = new DomInjector();
      injector.inject({
        scriptEl: script,
        slotId: "slot_no_sibling",
        reserved: [300, 250],
        containerEl: existingDiv,
      });

      expect(wrapper.children.length).toBe(initialChildCount);
    });
  });
});
