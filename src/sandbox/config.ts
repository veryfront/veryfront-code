import { CONFIG_INVALID } from "#veryfront/errors";
import { getVeryfrontCloudAuthToken } from "#veryfront/platform/cloud/resolver.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { resolveHostOwnedApiBaseUrl } from "#veryfront/config/host-api-base.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { createOriginBoundOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import type { SandboxOptions } from "./types.ts";

const NativeURL = URL;
const applyIntrinsic = Reflect.apply;
const stringTrim = String.prototype.trim;
const urlOriginGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "origin")?.get;

function trimString(value: string | undefined): string | undefined {
  return value === undefined ? undefined : applyIntrinsic(stringTrim, value, []) as string;
}

function isHostApiOrigin(value: string): boolean {
  if (!urlOriginGetter) return false;
  try {
    const selected = new NativeURL(value);
    const host = new NativeURL(resolveHostOwnedApiBaseUrl());
    return applyIntrinsic(urlOriginGetter, selected, []) ===
      applyIntrinsic(urlOriginGetter, host, []);
  } catch {
    return false;
  }
}

/** @internal Send sandbox traffic through the host transport and reject cross-origin redirects. */
export function fetchSandboxUrl(url: string, init?: RequestInit): Promise<Response> {
  return createOriginBoundOutboundFetch(url)(url, init);
}

export function resolveSandboxApiUrl(options: SandboxOptions = {}): string {
  const url = options.apiUrl || getHostEnv("VERYFRONT_API_URL");
  if (url) return url;

  // Fail closed: never silently default to the production API while attaching an
  // ambient auth token — a missing VERYFRONT_API_URL in staging/CI would
  // otherwise send credentialed traffic to prod. Require an explicit value.
  throw CONFIG_INVALID.create({
    detail: "Sandbox API URL not configured. Set VERYFRONT_API_URL or pass apiUrl explicitly.",
  });
}

export function resolveSandboxAuthToken(options: SandboxOptions = {}): string {
  const explicitToken = trimString(options.authToken);
  if (explicitToken) return explicitToken;

  // Caller-selected origins form a separate credential domain. Ambient
  // host login credentials can be reused only for the host API. A credential
  // already bound to the current request remains caller-owned.
  const selectedApiUrl = resolveSandboxApiUrl(options);
  if (!isHostApiOrigin(selectedApiUrl)) {
    const requestToken = trimString(getCurrentRequestContext()?.token);
    if (requestToken) return requestToken;
    throw CONFIG_INVALID.create({
      detail: "Sandbox auth must be provided explicitly for a custom API URL.",
    });
  }

  const authToken = getVeryfrontCloudAuthToken();
  if (authToken) return authToken;

  throw CONFIG_INVALID.create({
    detail:
      "Sandbox auth not configured. Set VERYFRONT_API_TOKEN, provide request-scoped Veryfront credentials, or pass authToken explicitly.",
  });
}
