import { getApiUrl } from "../shared/constants.ts";
import { readToken } from "../auth/token-store.ts";
import { isApiKeyToken, type UserInfo, validateCredential, validateToken } from "../auth/login.ts";
import { type EnvironmentConfig, getEnvironmentConfig } from "veryfront/config";
import { guardedExactHttpLoopbackOutboundFetch } from "#cli/outbound-fetch";
import { createCloudOnboardingTransport } from "../shared/cloud-onboarding-transport.ts";
import { withOnboardingDeadline } from "../shared/onboarding-fetch.ts";
import { getHostSecret } from "#cli/process-env";

const applyIntrinsic = Reflect.apply;
const stringTrim = String.prototype.trim;
const responseText = Response.prototype.text;
const NativeURL = URL;
const urlOriginGetter = Object.getOwnPropertyDescriptor(NativeURL.prototype, "origin")!.get!;

export interface RemoteProject {
  id: string;
  slug: string;
  name: string;
  description?: string;
  updatedAt?: string;
}

export interface ProjectDiscoveryResult {
  user: UserInfo | null;
  projects: RemoteProject[];
  credentialType?: "user" | "apiKey";
  error?: string;
}

export async function fetchRemoteProjects(
  apiToken?: string,
  env: EnvironmentConfig = getEnvironmentConfig(),
): Promise<ProjectDiscoveryResult> {
  const normalizedToken = apiToken === undefined
    ? undefined
    : applyIntrinsic(stringTrim, apiToken, []) as string;
  const token = normalizedToken || await readToken();

  if (!token) {
    return {
      user: null,
      projects: [],
      error: "Not authenticated. Press A to login.",
    };
  }

  const apiKeyCredential = isApiKeyToken(token);
  const apiUrl = getApiUrl(env);
  let explicitLoopback = false;
  if (normalizedToken && token !== getHostSecret("VERYFRONT_API_TOKEN")) {
    try {
      const origin = applyIntrinsic(urlOriginGetter, new NativeURL(apiUrl), []) as string;
      explicitLoopback = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin);
    } catch {
      // Keep invalid URL failures inside the existing discovery error path.
    }
  }
  let user: UserInfo | null = null;
  try {
    const transport: typeof fetch = explicitLoopback
      ? withOnboardingDeadline(guardedExactHttpLoopbackOutboundFetch)
      : createCloudOnboardingTransport(apiUrl);
    user = apiKeyCredential ? null : await validateToken(token, env, { transport });

    if (!apiKeyCredential && !user) {
      return {
        user: null,
        projects: [],
        error: "Session expired. Press A to login again.",
      };
    }

    const response = await transport(`${apiUrl}/projects`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await (applyIntrinsic(responseText, response, []) as Promise<string>).catch(
        () => response.statusText,
      );
      return {
        user,
        projects: [],
        credentialType: apiKeyCredential ? "apiKey" : "user",
        error: `Failed to fetch projects: ${errorText}`,
      };
    }

    const data = (await response.json()) as { data?: RemoteProject[] };
    return {
      user,
      projects: data.data ?? [],
      credentialType: apiKeyCredential ? "apiKey" : "user",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      user,
      projects: [],
      credentialType: apiKeyCredential ? "apiKey" : "user",
      error: `Network error: ${message}`,
    };
  }
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await readToken();
  if (!token) return false;

  return (await validateCredential(token)) !== null;
}

export async function getCurrentUser(): Promise<UserInfo | null> {
  const token = await readToken();
  if (!token) return null;
  if (isApiKeyToken(token)) return null;

  return validateToken(token);
}
