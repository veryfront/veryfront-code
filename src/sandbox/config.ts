import { CONFIG_INVALID } from "#veryfront/errors";
import { getVeryfrontCloudAuthToken } from "#veryfront/platform/cloud/resolver.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { getHostSecret, hasEnvFileValueSource } from "#veryfront/platform/compat/process/env.ts";
import {
  requireHostPrivateApiHttps,
  resolveHostOwnedApiBaseUrl,
} from "#veryfront/config/host-api-base.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { getCurrentVeryfrontCloudContext } from "#veryfront/provider/veryfront-cloud/context.ts";
import {
  createHostInternalOriginBoundOutboundFetch,
  createOriginBoundOutboundFetch,
} from "#veryfront/security/http/outbound-fetch.ts";
import type { SandboxOptions } from "./types.ts";

const NativeURL = URL;
const applyIntrinsic = Reflect.apply;
const stringTrim = String.prototype.trim;
const urlOriginGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "origin")?.get;
function trimString(value: string | undefined): string | undefined {
  return value === undefined ? undefined : applyIntrinsic(stringTrim, value, []) as string;
}

function isHostApiOrigin(value: string): boolean {
  return sameApiOrigin(value, resolveHostOwnedApiBaseUrl());
}

function sameApiOrigin(left: string, right: string): boolean {
  if (!urlOriginGetter) return false;
  try {
    return applyIntrinsic(urlOriginGetter, new NativeURL(left), []) ===
      applyIntrinsic(urlOriginGetter, new NativeURL(right), []);
  } catch {
    return false;
  }
}

/** @internal Send sandbox traffic through the host transport and reject cross-origin redirects. */
export function fetchSandboxUrl(url: string, init?: RequestInit): Promise<Response> {
  return createOriginBoundOutboundFetch(url)(url, init);
}

/** @internal Fetch a host-selected sandbox runtime route, including private Kubernetes DNS. */
export function fetchSandboxRuntimeUrl(url: string, init?: RequestInit): Promise<Response> {
  return createHostInternalOriginBoundOutboundFetch(url)(url, init);
}

export function resolveSandboxApiUrl(options: SandboxOptions = {}): string {
  const url = options.apiUrl || getCurrentVeryfrontCloudContext()?.apiBaseUrl ||
    getHostEnv("VERYFRONT_API_URL");
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
  // already bound to the current request remains caller-owned unless it is
  // the host-private login credential.
  const selectedApiUrl = resolveSandboxApiUrl(options);
  const scopedContext = getCurrentVeryfrontCloudContext();
  const scopedToken = trimString(scopedContext?.apiToken);
  const scopedApiUrl = trimString(scopedContext?.apiBaseUrl);
  if (scopedApiUrl && sameApiOrigin(selectedApiUrl, scopedApiUrl)) {
    if (scopedToken) return scopedToken;
    throw CONFIG_INVALID.create({
      detail: "Sandbox auth must be supplied with the scoped Veryfront API URL.",
    });
  }
  if (scopedToken) {
    if (!scopedApiUrl && isHostApiOrigin(selectedApiUrl)) return scopedToken;
    throw CONFIG_INVALID.create({
      detail: "Sandbox auth must match the scoped Veryfront API URL.",
    });
  }

  const requestToken = trimString(getCurrentRequestContext()?.token);
  if (requestToken) {
    if (requestToken === getHostSecret("VERYFRONT_API_TOKEN")) {
      if (!isHostApiOrigin(selectedApiUrl)) {
        throw CONFIG_INVALID.create({
          detail: "Sandbox auth must be provided explicitly for a custom API URL.",
        });
      }
      requireHostPrivateApiHttps(selectedApiUrl);
    }
    return requestToken;
  }

  if (options.apiUrl === undefined) {
    const environmentToken = trimString(getHostEnv("VERYFRONT_API_TOKEN"));
    if (environmentToken) {
      if (getHostSecret("VERYFRONT_API_TOKEN") === environmentToken) {
        if (isHostApiOrigin(selectedApiUrl)) {
          requireHostPrivateApiHttps(selectedApiUrl);
          return environmentToken;
        }
        throw CONFIG_INVALID.create({
          detail: "Sandbox auth must be provided explicitly for a custom API URL.",
        });
      }
      const tokenFromEnvFile = hasEnvFileValueSource("VERYFRONT_API_TOKEN");
      const urlFromEnvFile = hasEnvFileValueSource("VERYFRONT_API_URL");
      if (tokenFromEnvFile === urlFromEnvFile) return environmentToken;
      throw CONFIG_INVALID.create({
        detail: "Sandbox API URL and auth token must come from matching environment sources.",
      });
    }
  }

  if (!isHostApiOrigin(selectedApiUrl)) {
    throw CONFIG_INVALID.create({
      detail: "Sandbox auth must be provided explicitly for a custom API URL.",
    });
  }

  const authToken = getVeryfrontCloudAuthToken();
  if (authToken && authToken === getHostSecret("VERYFRONT_API_TOKEN")) {
    requireHostPrivateApiHttps(selectedApiUrl);
  }
  if (authToken) return authToken;

  throw CONFIG_INVALID.create({
    detail:
      "Sandbox auth not configured. Set VERYFRONT_API_TOKEN, provide request-scoped Veryfront credentials, or pass authToken explicitly.",
  });
}
