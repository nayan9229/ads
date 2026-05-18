import { ErrorCode, WrapperError } from "./errors";

export interface ErrorEvent {
  readonly code: ErrorCode;
  readonly message: string;
  readonly context: Readonly<Record<string, unknown>>;
}

export type ErrorHandler = (event: ErrorEvent) => void;

export class ErrorRegistry {
  private handlers: ErrorHandler[] = [];

  onError(handler: ErrorHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  fail(code: ErrorCode, message: string, context: Record<string, unknown> = {}): void {
    const event: ErrorEvent = Object.freeze({
      code,
      message,
      context: Object.freeze({ ...context }),
    });
    for (const h of this.handlers) {
      try {
        h(event);
      } catch {
        // Handler errors are suppressed; user-callback isolation.
      }
    }
  }

  wrap<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R | undefined {
    return (...args: A): R | undefined => {
      try {
        return fn(...args);
      } catch (err) {
        if (err instanceof WrapperError) {
          this.fail(err.code, err.message, err.context);
        } else {
          const message = err instanceof Error ? err.message : String(err);
          this.fail(ErrorCode.E_RENDER_FAIL, message, { thrown: err });
        }
        return undefined;
      }
    };
  }
}
