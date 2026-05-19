export interface InjectArgs {
  readonly scriptEl: HTMLScriptElement | null;
  readonly slotId: string;
  readonly reserved: readonly [number, number];
  readonly containerEl?: HTMLElement;
}

export class DomInjector {
  inject(args: InjectArgs): HTMLElement {
    if (args.containerEl) {
      args.containerEl.dataset.adwrapperSlot = args.slotId;
      return args.containerEl;
    }

    const target =
      args.scriptEl ?? (document.getElementById(args.slotId) as HTMLScriptElement | null);

    if (!target || !target.parentElement) {
      throw new Error(`DomInjector: no anchor element for slot ${args.slotId}`);
    }

    const container = document.createElement("div");
    container.dataset.adwrapperSlot = args.slotId;
    container.style.width = `${args.reserved[0]}px`;
    container.style.height = `${args.reserved[1]}px`;
    container.style.display = "inline-block";
    container.style.verticalAlign = "top";

    target.parentElement.insertBefore(container, target.nextSibling);
    return container;
  }
}
