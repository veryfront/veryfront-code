import { CLEANUP_CONFIG, SERVER_CONFIG, TEST_TIMEOUTS } from "./constants.ts";

export interface HttpPollingServer {
  ready?: Promise<void>;
  port?: number;
  hostname?: string;
  addr?: { hostname: string; port: number };
}

export type DelayFn = (ms: number) => Promise<void>;

const DEFAULT_READY_BACKOFF_FACTOR = 1.5;
const DEFAULT_READY_JITTER_MS = 100;
const DEFAULT_STOPPED_REQUEST_TIMEOUT_MS = 100;
const DEFAULT_STOPPED_MAX_ATTEMPTS = 10;
const DEFAULT_STOPPED_RETRY_DELAY_MS = 100;

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isReadyStatus(status: number): boolean {
  return status >= 200 && status < 600;
}

export function getHttpServerUrl(
  server: HttpPollingServer,
  options: { checkPath?: string; defaultPort?: number; defaultHostname?: string } = {},
): string {
  const {
    checkPath = "/",
    defaultPort = 3000,
    defaultHostname = "localhost",
  } = options;

  const port = server.port ?? server.addr?.port ?? defaultPort;
  const hostname = server.hostname ?? server.addr?.hostname ?? defaultHostname;
  return `http://${hostname}:${port}${checkPath}`;
}

export async function waitForPromiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });

    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchWithTimeout(
  url: string,
  timeoutMs: number = SERVER_CONFIG.FETCH_TIMEOUT,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function closeResponse(res: Response | undefined | null): Promise<void> {
  if (!res) return;

  try {
    await res.body?.cancel?.();
  } catch {
    // ignore cancellation errors in tests
  }

  try {
    // fallback read in case cancel is a no-op
    await res.arrayBuffer();
  } catch {
    // body may already be consumed
  }
}

async function probeHttpReady(
  url: string,
  options: { requestTimeoutMs?: number; verifyWithSecondRequest?: boolean } = {},
): Promise<boolean> {
  const { requestTimeoutMs = SERVER_CONFIG.FETCH_TIMEOUT, verifyWithSecondRequest = true } =
    options;

  const response = await fetchWithTimeout(url, requestTimeoutMs);
  try {
    if (!isReadyStatus(response.status)) return false;
    if (!verifyWithSecondRequest) return true;

    const verifyResponse = await fetchWithTimeout(url, requestTimeoutMs);
    try {
      return isReadyStatus(verifyResponse.status);
    } finally {
      await closeResponse(verifyResponse);
    }
  } finally {
    await closeResponse(response);
  }
}

export async function waitForHttpServerReadySignal(
  server: HttpPollingServer,
  options: { timeoutMs?: number; timeoutMessage?: string } = {},
): Promise<void> {
  if (typeof server.ready?.then !== "function") return;

  const { timeoutMs = TEST_TIMEOUTS.SERVER_STARTUP, timeoutMessage = "Server ready timeout" } =
    options;
  await waitForPromiseWithTimeout(server.ready, timeoutMs, timeoutMessage);
}

export interface ReadyByTimeoutPollResult {
  ready: boolean;
  attempts: number;
  lastError: Error | null;
}

export async function pollHttpReadyByTimeout(
  url: string,
  options: {
    timeoutMs?: number;
    retryDelayMs?: number;
    requestTimeoutMs?: number;
    verifyWithSecondRequest?: boolean;
    delay?: DelayFn;
  } = {},
): Promise<ReadyByTimeoutPollResult> {
  const {
    timeoutMs = TEST_TIMEOUTS.SERVER_STARTUP,
    retryDelayMs = CLEANUP_CONFIG.CLEANUP_RETRY_DELAY,
    requestTimeoutMs = SERVER_CONFIG.FETCH_TIMEOUT,
    verifyWithSecondRequest = true,
    delay = defaultDelay,
  } = options;

  const startTime = Date.now();
  let attempts = 0;
  let lastError: Error | null = null;

  while (Date.now() - startTime < timeoutMs) {
    attempts++;

    try {
      const ready = await probeHttpReady(url, { requestTimeoutMs, verifyWithSecondRequest });
      if (ready) return { ready: true, attempts, lastError };
    } catch (error) {
      lastError = error as Error;
      if (Date.now() - startTime < timeoutMs) await delay(retryDelayMs);
    }
  }

  return { ready: false, attempts, lastError };
}

export async function pollHttpReadyByAttempts(
  url: string,
  options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    backoffFactor?: number;
    jitterMs?: number;
    requestTimeoutMs?: number;
    verifyWithSecondRequest?: boolean;
    delay?: DelayFn;
  } = {},
): Promise<boolean> {
  const {
    maxAttempts = SERVER_CONFIG.MAX_READY_ATTEMPTS,
    baseDelayMs = SERVER_CONFIG.READY_CHECK_DELAY,
    maxDelayMs = SERVER_CONFIG.MAX_READY_DELAY,
    backoffFactor = DEFAULT_READY_BACKOFF_FACTOR,
    jitterMs = DEFAULT_READY_JITTER_MS,
    requestTimeoutMs = SERVER_CONFIG.FETCH_TIMEOUT,
    verifyWithSecondRequest = true,
    delay = defaultDelay,
  } = options;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const ready = await probeHttpReady(url, { requestTimeoutMs, verifyWithSecondRequest });
      if (ready) return true;
    } catch {
      // ignore; will retry
    }

    const nextDelayMs = Math.min(
      baseDelayMs * backoffFactor ** attempt + Math.random() * jitterMs,
      maxDelayMs,
    );
    await delay(nextDelayMs);
  }

  return false;
}

export async function pollHttpStoppedByTimeout(
  url: string,
  options: {
    timeoutMs?: number;
    retryDelayMs?: number;
    requestTimeoutMs?: number;
    delay?: DelayFn;
  } = {},
): Promise<boolean> {
  const {
    timeoutMs = CLEANUP_CONFIG.GRACEFUL_TIMEOUT,
    retryDelayMs = CLEANUP_CONFIG.CLEANUP_RETRY_DELAY,
    requestTimeoutMs = DEFAULT_STOPPED_REQUEST_TIMEOUT_MS,
    delay = defaultDelay,
  } = options;

  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetchWithTimeout(url, requestTimeoutMs);
      try {
        await delay(retryDelayMs);
      } finally {
        await closeResponse(response);
      }
    } catch {
      return true;
    }
  }

  return false;
}

export async function pollHttpStoppedByAttempts(
  url: string,
  options: {
    maxAttempts?: number;
    retryDelayMs?: number;
    requestTimeoutMs?: number;
    delay?: DelayFn;
  } = {},
): Promise<boolean> {
  const {
    maxAttempts = DEFAULT_STOPPED_MAX_ATTEMPTS,
    retryDelayMs = DEFAULT_STOPPED_RETRY_DELAY_MS,
    requestTimeoutMs = DEFAULT_STOPPED_REQUEST_TIMEOUT_MS,
    delay = defaultDelay,
  } = options;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetchWithTimeout(url, requestTimeoutMs);
      try {
        await delay(retryDelayMs);
      } finally {
        await closeResponse(response);
      }
    } catch {
      return true;
    }
  }

  return false;
}
