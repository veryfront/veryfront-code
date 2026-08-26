import type { AuthCookiePayload } from "./crypto.ts";
import { openAuthCookieEnvelope, sealAuthCookieEnvelope } from "./crypto.ts";

export const SESSION_COOKIE_NAME = "__Host-vf_session";

const TRANSACTION_COOKIE_PREFIX = "__Host-vf_oidc_tx_";
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_SET_COOKIE_HEADER_CHARS = 8_192;
const MAX_COOKIE_HEADER_CHARS = 64 * 1_024;
const COOKIE_ATTRIBUTES = "Path=/; HttpOnly; Secure; SameSite=Lax";

interface CreateAuthCookieOptions {
  readonly secret: string;
  readonly payload: AuthCookiePayload;
  readonly maxAgeSeconds: number;
  readonly now: number;
  readonly cookieName?: string;
  readonly requestUrl?: string;
  readonly randomBytes?: (length: number) => Uint8Array;
}

interface CreateTransactionCookieOptions extends CreateAuthCookieOptions {
  readonly state: string;
}

interface ReadSessionCookieOptions {
  readonly secret: string;
  readonly cookieHeader: string | null | undefined;
  readonly now: number;
  readonly maxLifetimeSeconds: number;
  readonly cookieName?: string;
}

interface ReadTransactionCookieOptions extends ReadSessionCookieOptions {
  readonly state: string;
}

export async function createSessionCookie(options: CreateAuthCookieOptions): Promise<string> {
  return await createCookie({
    ...options,
    purpose: "session",
    cookieName: validateSessionCookieName(options.cookieName ?? SESSION_COOKIE_NAME),
  });
}

export async function createTransactionCookie(
  options: CreateTransactionCookieOptions,
): Promise<string> {
  return await createCookie({
    ...options,
    purpose: "transaction",
    cookieName: getTransactionCookieName(options.state),
  });
}

export async function readSessionCookie(
  options: ReadSessionCookieOptions,
): Promise<AuthCookiePayload | null> {
  return await readCookie({
    ...options,
    purpose: "session",
    cookieName: validateSessionCookieName(options.cookieName ?? SESSION_COOKIE_NAME),
  });
}

export async function readTransactionCookie(
  options: ReadTransactionCookieOptions,
): Promise<AuthCookiePayload | null> {
  return await readCookie({
    ...options,
    purpose: "transaction",
    cookieName: getTransactionCookieName(options.state),
  });
}

export function clearSessionCookie(cookieName = SESSION_COOKIE_NAME): string {
  return clearCookie(validateSessionCookieName(cookieName));
}

export function clearTransactionCookie(state: string): string {
  return clearCookie(getTransactionCookieName(state));
}

export function getTransactionCookieName(state: string): string {
  if (!STATE_PATTERN.test(state)) {
    throw new TypeError("OIDC transaction state must be exactly 43 unpadded base64url characters");
  }
  return `${TRANSACTION_COOKIE_PREFIX}${state}`;
}

/** Clear older transaction cookies until the next request fits the cookie-header budget. */
export function clearExcessTransactionCookies(
  cookieHeader: string | null | undefined,
  newTransactionCookie: string,
): string[] {
  if (typeof cookieHeader !== "string" || cookieHeader.length > MAX_COOKIE_HEADER_CHARS) return [];
  const newPair = newTransactionCookie.split(";", 1)[0]?.trim() ?? "";
  if (!transactionStateFromPair(newPair)) return [];

  const transactions: Array<{ pair: string; state: string }> = [];
  let retainedLength = newPair.length;
  let retainedCount = 1;
  for (const rawPart of cookieHeader.split(";")) {
    const pair = rawPart.trim();
    if (pair.length === 0) continue;
    const state = transactionStateFromPair(pair);
    if (state !== null) {
      transactions.push({ pair, state });
      continue;
    }
    retainedLength += (retainedCount === 0 ? 0 : 2) + pair.length;
    retainedCount += 1;
  }

  const retainedStates = new Set<string>();
  for (let index = transactions.length - 1; index >= 0; index -= 1) {
    const transaction = transactions[index]!;
    const nextLength = retainedLength + (retainedCount === 0 ? 0 : 2) + transaction.pair.length;
    if (
      nextLength <= MAX_SET_COOKIE_HEADER_CHARS &&
      !retainedStates.has(transaction.state)
    ) {
      retainedStates.add(transaction.state);
      retainedLength = nextLength;
      retainedCount += 1;
    }
  }

  const clearedStates = new Set<string>();
  const clearCookies: string[] = [];
  for (const transaction of transactions) {
    if (retainedStates.has(transaction.state) || clearedStates.has(transaction.state)) continue;
    clearedStates.add(transaction.state);
    clearCookies.push(clearTransactionCookie(transaction.state));
  }
  return clearCookies;
}

function transactionStateFromPair(pair: string): string | null {
  const separator = pair.indexOf("=");
  if (separator < 0) return null;
  const name = pair.slice(0, separator);
  if (!name.startsWith(TRANSACTION_COOKIE_PREFIX)) return null;
  const state = name.slice(TRANSACTION_COOKIE_PREFIX.length);
  return STATE_PATTERN.test(state) ? state : null;
}

async function createCookie(
  options: CreateAuthCookieOptions & {
    readonly purpose: "session" | "transaction";
    readonly cookieName: string;
  },
): Promise<string> {
  validateMaxAge(options.maxAgeSeconds);
  const value = await sealAuthCookieEnvelope({
    secret: options.secret,
    purpose: options.purpose,
    cookieName: options.cookieName,
    payload: options.payload,
    issuedAt: options.now,
    expiresAt: options.now + options.maxAgeSeconds,
    randomBytes: options.randomBytes,
  });
  const setCookie =
    `${options.cookieName}=${value}; ${COOKIE_ATTRIBUTES}; Max-Age=${options.maxAgeSeconds}`;
  if (setCookie.length > MAX_SET_COOKIE_HEADER_CHARS) {
    throw new TypeError("Auth cookie Set-Cookie header exceeds the size limit");
  }
  return setCookie;
}

async function readCookie(
  options: ReadSessionCookieOptions & {
    readonly purpose: "session" | "transaction";
    readonly cookieName: string;
  },
): Promise<AuthCookiePayload | null> {
  const value = getCookieValue(options.cookieHeader, options.cookieName);
  if (value === null) return null;
  try {
    const opened = await openAuthCookieEnvelope({
      secret: options.secret,
      purpose: options.purpose,
      cookieName: options.cookieName,
      value,
      now: options.now,
      maxLifetimeSeconds: options.maxLifetimeSeconds,
    });
    return opened.payload;
  } catch {
    return null;
  }
}

function getCookieValue(
  cookieHeader: string | null | undefined,
  cookieName: string,
): string | null {
  if (typeof cookieHeader !== "string" || cookieHeader.length > MAX_COOKIE_HEADER_CHARS) {
    return null;
  }
  const prefix = `${cookieName}=`;
  let value: string | null = null;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      if (value !== null) return null;
      value = trimmed.slice(prefix.length);
    }
  }
  return value;
}

function clearCookie(cookieName: string): string {
  return `${cookieName}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}

function validateMaxAge(value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError("Auth cookie Max-Age must be a positive integer");
  }
}

function validateSessionCookieName(value: string): string {
  if (
    typeof value !== "string" ||
    value.length < "__Host-".length + 1 ||
    value.length > 128 ||
    !value.startsWith("__Host-") ||
    !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value)
  ) {
    throw new TypeError("Auth session cookie name must be a bounded __Host- HTTP token");
  }
  return value;
}
