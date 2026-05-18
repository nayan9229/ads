import { FallbackImageConfig } from "../core/config-registry";

export class FallbackRenderer {
  render(container: HTMLElement, fallback: FallbackImageConfig): void {
    container.replaceChildren();

    const img = document.createElement("img");
    img.src = fallback.url;
    img.alt = "";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "contain";
    img.style.display = "block";
    img.referrerPolicy = "no-referrer";

    if (fallback.clickUrl) {
      const link = document.createElement("a");
      link.href = fallback.clickUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.style.display = "block";
      link.style.width = "100%";
      link.style.height = "100%";
      link.appendChild(img);
      container.appendChild(link);
    } else {
      container.appendChild(img);
    }
  }
}
