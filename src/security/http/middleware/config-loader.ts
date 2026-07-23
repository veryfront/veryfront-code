import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import type { SecurityConfig } from "./types.ts";
import { validateCORSConfig } from "../cors/validators.ts";

const HTTP_TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const CSP_DIRECTIVE_RE = /^[A-Za-z][A-Za-z0-9-]*$/;
const MAX_SECURITY_CONFIG_PROPERTIES = 256;
const MAX_SECURITY_CONFIG_ARRAY_ITEMS = 1_024;

function snapshotRecord(value: unknown): Record<string, unknown> | null {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;

    const keys = Reflect.ownKeys(value);
    if (keys.length > MAX_SECURITY_CONFIG_PROPERTIES) return null;

    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (
        typeof key !== "string" || !descriptor?.enumerable || !("value" in descriptor)
      ) return null;
      Object.defineProperty(snapshot, key, {
        configurable: true,
        enumerable: true,
        value: descriptor.value,
        writable: true,
      });
    }
    return snapshot;
  } catch {
    return null;
  }
}

function snapshotArray(value: unknown): unknown[] | null {
  try {
    if (!Array.isArray(value)) return null;
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor)) return null;
    const length = lengthDescriptor.value;
    if (
      typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
      length > MAX_SECURITY_CONFIG_ARRAY_ITEMS
    ) return null;

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== length + 1) return null;

    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index++) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !("value" in descriptor)) return null;
      snapshot.push(descriptor.value);
    }
    return snapshot;
  } catch {
    return null;
  }
}

function isSafeValue(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidAuth(value: unknown): boolean {
  if (value === undefined) return true;
  const auth = snapshotRecord(value);
  if (!auth) return false;
  if (auth.basic !== undefined) {
    const basic = snapshotRecord(auth.basic);
    if (!basic) return false;
    if (!isNonEmptyString(basic.username) || !isNonEmptyString(basic.password)) {
      return false;
    }
    if (basic.realm !== undefined && typeof basic.realm !== "string") return false;
  }
  if (auth.bearer !== undefined) {
    const bearer = snapshotRecord(auth.bearer);
    if (!bearer || !isNonEmptyString(bearer.token)) return false;
  }
  return true;
}

function isValidCsrf(value: unknown): boolean {
  if (value === undefined || typeof value === "boolean") return true;
  const csrf = snapshotRecord(value);
  if (!csrf) return false;
  if (
    csrf.cookieName !== undefined &&
    (typeof csrf.cookieName !== "string" || !HTTP_TOKEN_RE.test(csrf.cookieName))
  ) return false;
  if (
    csrf.headerName !== undefined &&
    (typeof csrf.headerName !== "string" || !HTTP_TOKEN_RE.test(csrf.headerName))
  ) return false;
  if (
    csrf.ttlSec !== undefined &&
    (!Number.isSafeInteger(csrf.ttlSec) || (csrf.ttlSec as number) <= 0)
  ) return false;
  if (csrf.excludePaths !== undefined) {
    const excludePaths = snapshotArray(csrf.excludePaths);
    if (
      !excludePaths ||
      excludePaths.some((path) => typeof path !== "string" || !path.startsWith("/"))
    ) return false;
  }
  return true;
}

function isValidCsp(value: unknown): boolean {
  if (value === undefined) return true;
  const csp = snapshotRecord(value);
  if (!csp) return false;
  return Object.entries(csp).every(([directive, sources]) => {
    if (!CSP_DIRECTIVE_RE.test(directive)) return false;
    const values = typeof sources === "string" ? [sources] : snapshotArray(sources);
    if (!values) return false;
    return values.every((source) =>
      typeof source === "string" && isSafeValue(source) && !source.includes(";")
    );
  });
}

function isValidHsts(value: unknown): boolean {
  if (value === undefined) return true;
  const hsts = snapshotRecord(value);
  if (!hsts || !Number.isSafeInteger(hsts.maxAge) || (hsts.maxAge as number) < 0) {
    return false;
  }
  return [hsts.includeSubDomains, hsts.preload].every((flag) =>
    flag === undefined || typeof flag === "boolean"
  );
}

function isValidHeaders(value: unknown): boolean {
  if (value === undefined) return true;
  const headers = snapshotRecord(value);
  if (!headers) return false;
  return Object.entries(headers).every(([name, headerValue]) =>
    HTTP_TOKEN_RE.test(name) && typeof headerValue === "string" && isSafeValue(headerValue)
  );
}

function snapshotCors(value: unknown): boolean | Record<string, unknown> | undefined | null {
  if (value === undefined || typeof value === "boolean") return value;
  const cors = snapshotRecord(value);
  if (!cors) return null;

  for (const key of ["origin", "methods", "allowedHeaders", "exposedHeaders"] as const) {
    const entry = cors[key];
    if (entry === undefined) continue;
    if (key === "origin" && (typeof entry === "string" || typeof entry === "function")) continue;
    const array = snapshotArray(entry);
    if (!array) return null;
    cors[key] = array;
  }
  return cors;
}

function isValidAllowedImportDir(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_PATH_LENGTH_CHARS && isSafeValue(value) &&
    value !== "." && value !== ".." &&
    !value.includes("/") && !value.includes("\\");
}

function isValidAllowedImportDirs(value: unknown): boolean {
  const allowedImportDirs = snapshotArray(value);
  return allowedImportDirs !== null && allowedImportDirs.every(isValidAllowedImportDir);
}

function isValidRemoteHosts(value: unknown): boolean {
  if (value === undefined) return true;
  const remoteHosts = snapshotArray(value);
  if (!remoteHosts) return false;
  return remoteHosts.every((host) => {
    if (typeof host !== "string") return false;
    try {
      const url = new URL(host);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  });
}

export function isValidSecurityConfig(config: unknown): config is SecurityConfig {
  const cfg = snapshotRecord(config);
  if (!cfg) return false;

  if (
    cfg.allowedImportDirs !== undefined && !isValidAllowedImportDirs(cfg.allowedImportDirs)
  ) {
    return false;
  }

  if (!isValidAuth(cfg.auth) || !isValidCsrf(cfg.csrf) || !isValidCsp(cfg.csp)) return false;

  const cors = snapshotCors(cfg.cors);
  if (cors === null) return false;
  if (!validateCORSConfig(cors as never).valid) return false;

  if (
    cfg.coop !== undefined &&
    (typeof cfg.coop !== "string" ||
      !["same-origin", "same-origin-allow-popups", "unsafe-none"].includes(cfg.coop))
  ) return false;
  if (
    cfg.corp !== undefined &&
    (typeof cfg.corp !== "string" ||
      !["same-origin", "same-site", "cross-origin"].includes(cfg.corp))
  ) return false;
  if (
    cfg.coep !== undefined &&
    (typeof cfg.coep !== "string" || !["require-corp", "unsafe-none"].includes(cfg.coep))
  ) return false;
  if (!isValidHsts(cfg.hsts) || !isValidHeaders(cfg.headers)) return false;
  if (!isValidRemoteHosts(cfg.remoteHosts)) return false;

  return true;
}

export function loadSecurityConfig(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<SecurityConfig | null> {
  return withSpan(
    "security.config.load",
    async (): Promise<SecurityConfig | null> => {
      const { getConfig } = await import("#veryfront/config");
      const cfg = await getConfig(projectDir, adapter);
      const securityConfig = (cfg as Record<string, unknown>)?.security;

      if (!securityConfig) return null;

      if (!isValidSecurityConfig(securityConfig)) {
        throw new TypeError("Invalid security configuration");
      }

      return securityConfig;
    },
    {},
  );
}
