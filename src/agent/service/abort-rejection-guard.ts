export type AbortRejectionGuardLogger = {
  warn?: (message: string, metadata?: Record<string, unknown>) => void;
};

export type AbortRejectionProcessTarget = {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
  off?(event: "unhandledRejection", listener: (reason: unknown) => void): void;
};

export type AbortRejectionEvent = {
  reason: unknown;
  preventDefault(): void;
};

export type AbortRejectionEventTarget = {
  addEventListener(
    event: "unhandledrejection",
    listener: (event: AbortRejectionEvent) => void,
  ): void;
  removeEventListener?(
    event: "unhandledrejection",
    listener: (event: AbortRejectionEvent) => void,
  ): void;
};

export type InstallAbortRejectionGuardOptions = {
  loadLogger?: () => AbortRejectionGuardLogger | Promise<AbortRejectionGuardLogger>;
  fallbackWarn?: (message: string, metadata?: Record<string, unknown>) => void;
  processTarget?: AbortRejectionProcessTarget | null;
  eventTarget?: AbortRejectionEventTarget | null;
  cause?: string;
};

export type InstalledAbortRejectionGuard = {
  dispose(): void;
};

function hasAbortErrorName(reason: unknown): boolean {
  return typeof reason === "object" && reason !== null && "name" in reason &&
    reason.name === "AbortError";
}

export function isAbortRejectionReason(reason: unknown): boolean {
  return hasAbortErrorName(reason);
}

function getReasonName(reason: unknown): string | null {
  if (typeof reason !== "object" || reason === null || !("name" in reason)) {
    return null;
  }
  return typeof reason.name === "string" ? reason.name : null;
}

function getReasonMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function getReasonStack(reason: unknown): string | null {
  return reason instanceof Error ? reason.stack ?? null : null;
}

function createAbortRejectionMetadata(
  reason: unknown,
  cause: string,
): Record<string, unknown> {
  return {
    cause,
    name: getReasonName(reason),
    message: getReasonMessage(reason),
    stack: getReasonStack(reason),
  };
}

function resolveDefaultProcessTarget(): AbortRejectionProcessTarget | null {
  if (typeof process === "undefined") {
    return null;
  }

  return process;
}

async function logAbortRejection(
  reason: unknown,
  options:
    & Required<Pick<InstallAbortRejectionGuardOptions, "cause" | "fallbackWarn">>
    & Pick<InstallAbortRejectionGuardOptions, "loadLogger">,
): Promise<void> {
  const metadata = createAbortRejectionMetadata(reason, options.cause);
  try {
    const logger = await options.loadLogger?.();
    if (logger?.warn) {
      logger.warn("Agent abort rejection swallowed", metadata);
      return;
    }
  } catch (importError) {
    options.fallbackWarn("Agent abort rejection swallowed before logger was available", {
      reason: getReasonMessage(reason),
      loggerImportError: getReasonMessage(importError),
    });
    return;
  }

  options.fallbackWarn("Agent abort rejection swallowed", metadata);
}

export function installAbortRejectionGuard(
  options: InstallAbortRejectionGuardOptions = {},
): InstalledAbortRejectionGuard {
  const processTarget = options.processTarget === undefined
    ? resolveDefaultProcessTarget()
    : options.processTarget;
  const fallbackWarn = options.fallbackWarn ?? console.warn;
  const cause = options.cause ?? "process_unhandled_rejection_abort";
  const logOptions = {
    cause,
    fallbackWarn,
    loadLogger: options.loadLogger,
  };

  const nodeHandler = (reason: unknown): void => {
    if (!isAbortRejectionReason(reason)) {
      throw reason;
    }
    void logAbortRejection(reason, logOptions);
  };

  processTarget?.on("unhandledRejection", nodeHandler);

  let customEventTargetHandler: ((event: AbortRejectionEvent) => void) | undefined;
  let browserHandler: ((event: PromiseRejectionEvent) => void) | undefined;
  if (options.eventTarget) {
    customEventTargetHandler = (event) => {
      if (!isAbortRejectionReason(event.reason)) {
        return;
      }
      event.preventDefault();
      void logAbortRejection(event.reason, logOptions);
    };
    options.eventTarget.addEventListener("unhandledrejection", customEventTargetHandler);
  } else if (typeof globalThis.addEventListener === "function") {
    browserHandler = (event) => {
      if (!isAbortRejectionReason(event.reason)) {
        return;
      }
      event.preventDefault();
      void logAbortRejection(event.reason, logOptions);
    };
    globalThis.addEventListener("unhandledrejection", browserHandler);
  }

  return {
    dispose() {
      processTarget?.off?.("unhandledRejection", nodeHandler);
      if (customEventTargetHandler) {
        options.eventTarget?.removeEventListener?.("unhandledrejection", customEventTargetHandler);
      }
      if (browserHandler && typeof globalThis.removeEventListener === "function") {
        globalThis.removeEventListener("unhandledrejection", browserHandler);
      }
    },
  };
}
