type Callable = (...args: never[]) => unknown;

const MAX_TEST_TIMEOUT_MS = 2_147_483_647;

const REQUIRED_BUN_TEST_EXPORTS = [
  "describe",
  "it",
  "beforeEach",
  "afterEach",
  "beforeAll",
  "afterAll",
] as const;

export type BunTestAdapter = Record<(typeof REQUIRED_BUN_TEST_EXPORTS)[number], Callable>;

function isBunTestAdapter(value: unknown): value is BunTestAdapter {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return false;
  }

  try {
    return REQUIRED_BUN_TEST_EXPORTS.every((key) => typeof Reflect.get(value, key) === "function");
  } catch {
    return false;
  }
}

/** Resolve the Bun test API from either its named or default ESM export shape. */
export function resolveBunTestAdapter(imported: unknown): BunTestAdapter | undefined {
  let defaultExport: unknown;
  if ((typeof imported === "object" || typeof imported === "function") && imported !== null) {
    try {
      defaultExport = Reflect.get(imported, "default");
    } catch {
      return undefined;
    }
  }

  if (isBunTestAdapter(defaultExport)) return defaultExport;
  return isBunTestAdapter(imported) ? imported : undefined;
}

/** Validate and normalize a portable test timeout. */
export function validateTestTimeout(timeoutMs: number): number {
  if (
    !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 ||
    timeoutMs > MAX_TEST_TIMEOUT_MS
  ) {
    throw new RangeError(
      `Test timeout must be an integer between 1 and ${MAX_TEST_TIMEOUT_MS}ms`,
    );
  }
  return timeoutMs;
}

/** Resolve an optional runtime timeout while preserving a validated default. */
export function resolveDefaultTestTimeout(
  rawTimeoutMs: string | undefined,
  defaultTimeoutMs: number,
): number {
  const validatedDefault = validateTestTimeout(defaultTimeoutMs);
  if (rawTimeoutMs === undefined) return validatedDefault;

  try {
    return validateTestTimeout(Number(rawTimeoutMs));
  } catch {
    return validatedDefault;
  }
}

/** Wrap a test or hook function with a bounded portable timeout. */
export function wrapTestFunctionWithTimeout<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void | Promise<void>,
  timeoutMs: number,
): (...args: TArgs) => Promise<void> {
  const validatedTimeoutMs = validateTestTimeout(timeoutMs);

  return async (...args: TArgs): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`Test timed out after ${validatedTimeoutMs}ms`);
        error.name = "TimeoutError";
        reject(error);
      }, validatedTimeoutMs);
    });

    try {
      await Promise.race([
        Promise.resolve().then(() => fn(...args)),
        timeout,
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}
