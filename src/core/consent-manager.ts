export interface ConsentState {
  readonly tcString?: string;
  readonly uspString?: string;
  readonly blocked: boolean;
}

export interface ConsentManagerOptions {
  readonly timeoutMs: number;
  readonly timezone?: string;
}

interface TcfApi {
  (command: string, version: number, cb: (data: TcData | null, success: boolean) => void): void;
}

interface TcData {
  readonly tcString?: string;
  readonly eventStatus?: string;
  readonly gdprApplies?: boolean;
  readonly purpose?: { readonly consents?: Record<number, boolean> };
}

interface UspApi {
  (command: string, version: number, cb: (data: UspData | null, success: boolean) => void): void;
}

interface UspData {
  readonly uspString?: string;
}

const EU_TZ_PREFIXES = ["Europe/"];
const UK_TZ = "Europe/London";

function isEuOrUkTimezone(tz: string): boolean {
  if (tz === UK_TZ) return true;
  return EU_TZ_PREFIXES.some((p) => tz.startsWith(p));
}

export class ConsentManager {
  constructor(private readonly opts: ConsentManagerOptions) {}

  resolve(): Promise<ConsentState> {
    return new Promise<ConsentState>((resolve) => {
      let settled = false;
      let tcString: string | undefined;
      let uspString: string | undefined;

      const finalize = (state: ConsentState) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(state);
      };

      const timer = setTimeout(() => {
        if (tcString !== undefined || uspString !== undefined) {
          finalize({
            ...(tcString !== undefined ? { tcString } : {}),
            ...(uspString !== undefined ? { uspString } : {}),
            blocked: false,
          });
        } else {
          finalize(this.buildNoCmpState());
        }
      }, this.opts.timeoutMs);

      const tcfApi = (window as unknown as { __tcfapi?: TcfApi }).__tcfapi;
      if (typeof tcfApi === "function") {
        tcfApi("addEventListener", 2, (data, success) => {
          if (!success || !data) return;
          if (data.eventStatus === "tcloaded" || data.eventStatus === "useractioncomplete") {
            tcString = data.tcString;
            const blocked = data.gdprApplies === true && data.purpose?.consents?.[1] !== true;
            finalize({
              ...(tcString !== undefined ? { tcString } : {}),
              ...(uspString !== undefined ? { uspString } : {}),
              blocked,
            });
          }
        });
      }

      const uspApi = (window as unknown as { __uspapi?: UspApi }).__uspapi;
      if (typeof uspApi === "function") {
        uspApi("getUSPData", 1, (data, success) => {
          if (!success || !data) return;
          uspString = data.uspString;
        });
      }
    });
  }

  private buildNoCmpState(): ConsentState {
    const tz = this.opts.timezone ?? this.detectTimezone();
    const inEu = isEuOrUkTimezone(tz);
    return { blocked: inEu };
  }

  private detectTimezone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "UTC";
    }
  }
}
