/**
 * Bridge Console Capture & Error Handling
 *
 * Intercepts console methods and runtime errors, forwarding them to Studio.
 */

import { CONSOLE_METHODS, state } from "./bridge-state.ts";
import { postToStudio } from "./bridge-messaging.ts";
import { hideOverlay } from "./bridge-inspector.ts";

export function setupConsoleCapture(): void {
  CONSOLE_METHODS.forEach((method) => {
    state.originalConsole[method] = (console as any)[method];
    (console as any)[method] = function (...args: any[]) {
      state.originalConsole[method]!.apply(console, args);

      const logId = "vf-" + Date.now() + "-" + ++state.logCounter;

      const formattedData = args.map((arg) => {
        try {
          if (arg instanceof Error) {
            return { __isError: true, message: arg.message, stack: arg.stack, name: arg.name };
          }
          if (arg === undefined) return { __isUndefined: true };
          if (arg === null) return null;
          if (typeof arg === "function") {
            return { __isFunction: true, name: arg.name || "anonymous" };
          }
          if (typeof arg === "symbol") return { __isSymbol: true, description: arg.description };
          if (typeof arg === "object") return JSON.parse(JSON.stringify(arg));
          return arg;
        } catch {
          return String(arg);
        }
      });

      postToStudio({
        action: "logEvent",
        value: {
          id: logId,
          method: method,
          data: formattedData,
          timestamp: new Date().toISOString(),
        },
      });
    };
  });
}

export function setupErrorHandling(): void {
  function hideOverlays() {
    hideOverlay(state.hoverOverlay);
    hideOverlay(state.selectionOverlay);
  }

  window.addEventListener("error", function (event) {
    hideOverlays();
    postToStudio({
      action: "runtimeError",
      url: window.location.href,
      errors: [
        {
          type: "error",
          message: event.message,
          file: event.filename,
          line: event.lineno,
          column: event.colno,
        },
      ],
    });
  });

  window.addEventListener("unhandledrejection", function (event) {
    hideOverlays();
    const reason = event.reason;
    postToStudio({
      action: "runtimeError",
      url: window.location.href,
      errors: [
        {
          type: "error",
          message: reason instanceof Error ? reason.message : String(reason),
          file: reason instanceof Error ? reason.stack : undefined,
        },
      ],
    });
  });
}
