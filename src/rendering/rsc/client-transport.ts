const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** Maximum number of independently addressed DOM slots in one RSC response. */
export const MAX_RSC_CLIENT_SLOTS = 256;

/** Bound one client transport attempt, including response-body consumption. */
export const RSC_CLIENT_REQUEST_TIMEOUT_MS = 30_000;

export interface ClientRequestLifetime {
  readonly signal: AbortSignal;
  dispose(): void;
}

function defaultLifecycleTarget(): EventTarget | null {
  return typeof globalThis.addEventListener === "function" &&
      typeof globalThis.removeEventListener === "function"
    ? globalThis
    : null;
}

/**
 * Tie a browser request to both a finite deadline and the page lifecycle.
 *
 * Callers must dispose the returned lifetime in `finally`; disposal removes
 * the `pagehide` listener and clears the timer even after an abort.
 */
export function createClientRequestLifetime(
  timeoutMs = RSC_CLIENT_REQUEST_TIMEOUT_MS,
  lifecycleTarget: EventTarget | null = defaultLifecycleTarget(),
): ClientRequestLifetime {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_TIMER_DELAY_MS
  ) {
    throw new RangeError(
      `Client request timeout must be an integer between 1 and ${MAX_TIMER_DELAY_MS}`,
    );
  }

  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const timeoutId = setTimeout(abort, timeoutMs);
  let listening = false;
  let disposed = false;

  if (lifecycleTarget) {
    try {
      lifecycleTarget.addEventListener("pagehide", abort, { once: true });
      listening = true;
    } catch {
      // A replaced browser global must not prevent the bounded timeout.
    }
  }

  return {
    signal: controller.signal,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearTimeout(timeoutId);
      if (!listening || !lifecycleTarget) return;

      try {
        lifecycleTarget.removeEventListener("pagehide", abort);
      } catch {
        // The request is already complete; cleanup remains best effort.
      }
      listening = false;
    },
  };
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A response can already be cancelled by its request signal.
  }
}

function contentLengthExceedsLimit(response: Response, maxBytes: number): boolean {
  const rawLength = response.headers.get("content-length")?.trim();
  if (!rawLength || !/^(?:0|[1-9]\d*)$/.test(rawLength)) return false;

  const length = Number(rawLength);
  return !Number.isSafeInteger(length) || length > maxBytes;
}

/**
 * Read and parse one JSON response without trusting `Content-Length`.
 *
 * The streaming byte count is authoritative and the body is cancelled as soon
 * as it exceeds the configured budget.
 */
export async function readJsonResponseWithinLimit(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("RSC JSON response byte limit must be a positive safe integer");
  }

  if (contentLengthExceedsLimit(response, maxBytes)) {
    await cancelResponseBody(response);
    throw new RangeError(`RSC JSON response byte limit of ${maxBytes} was exceeded`);
  }

  if (!response.body) {
    throw new SyntaxError("RSC JSON response body is empty");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  const textChunks: string[] = [];
  let finished = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        textChunks.push(decoder.decode());
        finished = true;
        break;
      }
      if (!value) continue;

      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        throw new RangeError(`RSC JSON response byte limit of ${maxBytes} was exceeded`);
      }
      textChunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    if (!finished) {
      try {
        await reader.cancel();
      } catch {
        // The request signal may have cancelled the stream concurrently.
      }
    }

    try {
      reader.releaseLock();
    } catch {
      // A host stream may release its lock while handling cancellation.
    }
  }

  return JSON.parse(textChunks.join("")) as unknown;
}

export function isValidRscSlotId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value !== "." &&
    value !== ".." &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}
