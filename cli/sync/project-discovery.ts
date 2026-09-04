import { getApiUrl } from "../shared/constants.ts";
import { readToken } from "../auth/token-store.ts";
import { isApiKeyToken, type UserInfo, validateCredential, validateToken } from "../auth/login.ts";

const applyIntrinsic = Reflect.apply;
const stringTrim = String.prototype.trim;
const stringReplace = String.prototype.replace;

interface ProjectDiscoveryOptions {
  apiBaseUrl?: string;
  transport?: typeof fetch;
}

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
  options: ProjectDiscoveryOptions = {},
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
  const user = apiKeyCredential ? null : await validateToken(token, undefined, {
    apiBaseUrl: options.apiBaseUrl,
    transport: options.transport,
  });

  if (!apiKeyCredential && !user) {
    return {
      user: null,
      projects: [],
      error: "Session expired. Press A to login again.",
    };
  }

  try {
    const apiBaseUrl = options.apiBaseUrl ?? getApiUrl();
    const baseUrl = applyIntrinsic(stringReplace, apiBaseUrl, [/\/$/, ""]) as string;
    const transport = options.transport ?? fetch;
    const response = await transport(`${baseUrl}/projects`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
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
