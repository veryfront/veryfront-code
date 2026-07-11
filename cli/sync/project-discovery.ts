import { getApiUrl } from "../shared/constants.ts";
import { readToken } from "../auth/token-store.ts";
import { isApiKeyToken, type UserInfo, validateCredential, validateToken } from "../auth/login.ts";

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

export async function fetchRemoteProjects(apiToken?: string): Promise<ProjectDiscoveryResult> {
  const token = apiToken?.trim() || await readToken();

  if (!token) {
    return {
      user: null,
      projects: [],
      error: "Not authenticated. Press A to login.",
    };
  }

  const apiKeyCredential = isApiKeyToken(token);
  const user = apiKeyCredential ? null : await validateToken(token);

  if (!apiKeyCredential && !user) {
    return {
      user: null,
      projects: [],
      error: "Session expired. Press A to login again.",
    };
  }

  try {
    const response = await fetch(`${getApiUrl()}/projects`, {
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
