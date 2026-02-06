import { getApiUrl } from "../shared/constants.ts";
import { readToken } from "../auth/token-store.ts";
import { type UserInfo, validateToken } from "../auth/login.ts";

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
  error?: string;
}

export async function fetchRemoteProjects(): Promise<ProjectDiscoveryResult> {
  const token = await readToken();

  if (!token) {
    return {
      user: null,
      projects: [],
      error: "Not authenticated. Press A to login.",
    };
  }

  const user = await validateToken(token);

  if (!user) {
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
        error: `Failed to fetch projects: ${errorText}`,
      };
    }

    const data = (await response.json()) as { data?: RemoteProject[] };
    return { user, projects: data.data ?? [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      user,
      projects: [],
      error: `Network error: ${message}`,
    };
  }
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await readToken();
  if (!token) return false;

  return (await validateToken(token)) !== null;
}

export async function getCurrentUser(): Promise<UserInfo | null> {
  const token = await readToken();
  if (!token) return null;

  return validateToken(token);
}
