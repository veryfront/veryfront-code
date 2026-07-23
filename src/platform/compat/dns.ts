import {
  INVALID_ARGUMENT,
  NOT_SUPPORTED,
  TIMEOUT_ERROR,
} from "#veryfront/errors/error-registry/general.ts";
import { NETWORK_ERROR } from "#veryfront/errors/error-registry/server.ts";
import { getDenoRuntime, isBun, isDeno, isNode } from "./runtime.ts";

export type DnsAddressRecordType = "A" | "AAAA";

export interface ResolveHostAddressesOptions {
  recordTypes?: readonly DnsAddressRecordType[];
  /** Maximum time for the complete lookup. Defaults to 10 seconds. */
  timeoutMs?: number;
  /** Cancels the lookup result. Native resolver work may continue in the background. */
  signal?: AbortSignal;
}

interface NormalizedDnsOptions {
  recordTypes: readonly DnsAddressRecordType[];
  timeoutMs: number;
  signal?: AbortSignal;
}

const DEFAULT_DNS_LOOKUP_TIMEOUT_MS = 10_000;
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;
const DEFAULT_RECORD_TYPES: readonly DnsAddressRecordType[] = Object.freeze(["A", "AAAA"]);
const SUPPORTED_RECORD_TYPES = new Set<DnsAddressRecordType>(DEFAULT_RECORD_TYPES);
const OPTION_NAMES = new Set<keyof ResolveHostAddressesOptions>([
  "recordTypes",
  "timeoutMs",
  "signal",
]);
const ABSENT_DNS_ERROR_CODES = new Set(["ENODATA", "ENOTFOUND", "EAI_NODATA", "EAI_NONAME"]);

function readErrorField(error: unknown, key: "code" | "name"): string | undefined {
  if ((typeof error !== "object" && typeof error !== "function") || error === null) {
    return undefined;
  }
  try {
    const value = Reflect.get(error, key);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function isMissingDnsRecord(error: unknown): boolean {
  return readErrorField(error, "name") === "NotFound" ||
    ABSENT_DNS_ERROR_CODES.has(readErrorField(error, "code") ?? "");
}

function snapshotOptions(options: unknown): NormalizedDnsOptions {
  let optionsIsArray: boolean;
  try {
    optionsIsArray = Array.isArray(options);
  } catch {
    throw INVALID_ARGUMENT.create({ message: "DNS lookup options are not readable" });
  }
  if (typeof options !== "object" || options === null || optionsIsArray) {
    throw INVALID_ARGUMENT.create({ message: "DNS lookup options must be an object" });
  }

  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(options);
  } catch {
    throw INVALID_ARGUMENT.create({ message: "DNS lookup options are not readable" });
  }

  const values = new Map<keyof ResolveHostAddressesOptions, unknown>();
  for (const key of keys) {
    if (typeof key !== "string" || !OPTION_NAMES.has(key as keyof ResolveHostAddressesOptions)) {
      throw INVALID_ARGUMENT.create({ message: "DNS lookup option is not supported" });
    }
    try {
      values.set(key as keyof ResolveHostAddressesOptions, Reflect.get(options, key));
    } catch {
      throw INVALID_ARGUMENT.create({ message: "DNS lookup options are not readable" });
    }
  }

  const rawRecordTypes = values.get("recordTypes");
  const recordTypes: DnsAddressRecordType[] = [];
  if (rawRecordTypes === undefined) {
    recordTypes.push(...DEFAULT_RECORD_TYPES);
  } else {
    let recordTypesAreArray: boolean;
    try {
      recordTypesAreArray = Array.isArray(rawRecordTypes);
    } catch {
      throw INVALID_ARGUMENT.create({ message: "DNS recordTypes are not readable" });
    }
    if (!recordTypesAreArray) {
      throw INVALID_ARGUMENT.create({ message: "DNS recordTypes must be an array" });
    }
    const recordTypeArray = rawRecordTypes as readonly unknown[];

    let length: unknown;
    try {
      length = Reflect.get(recordTypeArray, "length");
    } catch {
      throw INVALID_ARGUMENT.create({ message: "DNS recordTypes are not readable" });
    }
    if (
      typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
      length > SUPPORTED_RECORD_TYPES.size
    ) {
      throw INVALID_ARGUMENT.create({
        message: "DNS recordTypes must contain at most one entry per supported record type",
      });
    }

    for (let index = 0; index < length; index++) {
      let recordType: unknown;
      try {
        recordType = Reflect.get(recordTypeArray, index);
      } catch {
        throw INVALID_ARGUMENT.create({ message: "DNS recordTypes are not readable" });
      }
      if (!SUPPORTED_RECORD_TYPES.has(recordType as DnsAddressRecordType)) {
        throw INVALID_ARGUMENT.create({ message: "DNS record type is not supported" });
      }
      if (!recordTypes.includes(recordType as DnsAddressRecordType)) {
        recordTypes.push(recordType as DnsAddressRecordType);
      }
    }
  }

  const rawTimeout = values.get("timeoutMs");
  const timeoutMs = rawTimeout ?? DEFAULT_DNS_LOOKUP_TIMEOUT_MS;
  if (
    typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0 ||
    timeoutMs > MAX_TIMER_DELAY_MS
  ) {
    throw INVALID_ARGUMENT.create({
      message:
        `DNS lookup timeoutMs must be greater than 0 and no more than ${MAX_TIMER_DELAY_MS} milliseconds`,
    });
  }

  const signal = values.get("signal");
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw INVALID_ARGUMENT.create({ message: "DNS lookup signal must be an AbortSignal" });
  }

  return { recordTypes: Object.freeze(recordTypes), timeoutMs, signal };
}

function normalizeHostname(hostname: unknown): string {
  if (typeof hostname !== "string") {
    throw INVALID_ARGUMENT.create({ message: "DNS hostname must be a string" });
  }
  const normalized = hostname.trim();
  const containsInvalidCharacter = Array.from(
    normalized,
    (character) => character.codePointAt(0) ?? 0,
  ).some((codePoint) => codePoint <= 0x20 || codePoint === 0x7f);
  if (normalized.length === 0 || normalized.length > 253 || containsInvalidCharacter) {
    throw INVALID_ARGUMENT.create({ message: "DNS hostname is invalid" });
  }
  return normalized;
}

function createCancelledError(): DOMException {
  return new DOMException("DNS lookup was cancelled", "AbortError");
}

function waitForLookup<T>(
  operation: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(createCancelledError());

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(createCancelledError()));
    const timeout = setTimeout(
      () => finish(() => reject(TIMEOUT_ERROR.create({ message: "DNS lookup timed out" }))),
      timeoutMs,
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

async function resolveRecord(
  hostname: string,
  recordType: DnsAddressRecordType,
): Promise<string[]> {
  let lookup: () => Promise<string[]>;
  if (isDeno) {
    const deno = getDenoRuntime();
    if (!deno) {
      throw NOT_SUPPORTED.create({
        message: "DNS resolution is not available in this runtime",
      });
    }
    let resolveDns: unknown;
    try {
      resolveDns = Reflect.get(deno, "resolveDns");
    } catch {
      throw NOT_SUPPORTED.create({
        message: "DNS resolution is not available in this runtime",
      });
    }
    if (typeof resolveDns !== "function") {
      throw NOT_SUPPORTED.create({
        message: "DNS resolution is not available in this runtime",
      });
    }
    lookup = () => Reflect.apply(resolveDns, deno, [hostname, recordType]);
  } else if (isNode || isBun) {
    lookup = async () => {
      const dns = await import("node:dns/promises");
      return recordType === "A" ? await dns.resolve4(hostname) : await dns.resolve6(hostname);
    };
  } else {
    throw NOT_SUPPORTED.create({
      message: "DNS resolution is not available in this runtime",
    });
  }

  try {
    return await lookup();
  } catch (error) {
    if (isMissingDnsRecord(error)) return [];
    throw NETWORK_ERROR.create({ message: "DNS lookup failed" });
  }
}

export async function resolveHostAddresses(
  hostname: string,
  options: ResolveHostAddressesOptions = {},
): Promise<string[]> {
  const normalizedHostname = normalizeHostname(hostname);
  const normalizedOptions = snapshotOptions(options);
  if (normalizedOptions.signal?.aborted) throw createCancelledError();

  const operation = Promise.all(
    normalizedOptions.recordTypes.map((recordType) =>
      resolveRecord(normalizedHostname, recordType)
    ),
  );
  const results = await waitForLookup(
    operation,
    normalizedOptions.timeoutMs,
    normalizedOptions.signal,
  );
  return [...new Set(results.flat())];
}
