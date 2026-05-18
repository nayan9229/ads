interface SpvEvent extends Event {
  readonly violatedDirective?: string;
  readonly blockedURI?: string;
  readonly sourceFile?: string;
}

export class CspViolationLogger {
  private handler: ((evt: Event) => void) | null = null;

  start(): void {
    if (this.handler || typeof document === "undefined") return;
    this.handler = (raw: Event): void => {
      const evt = raw as SpvEvent;
      console.warn("[AdWrapper] CSP violation", {
        violatedDirective: evt.violatedDirective,
        blockedURI: evt.blockedURI,
        sourceFile: evt.sourceFile,
      });
    };
    document.addEventListener("securitypolicyviolation", this.handler);
  }

  dispose(): void {
    if (this.handler && typeof document !== "undefined") {
      document.removeEventListener("securitypolicyviolation", this.handler);
      this.handler = null;
    }
  }
}
