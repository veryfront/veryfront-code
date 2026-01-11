/**
 * Shared CLI configuration for pull/push commands
 *
 * Handles API URL, authentication tokens, and project resolution.
 * @module cli/shared/config
 */

import { join } from "std/path/mod.ts";
import { cwd } from "@veryfront/platform/compat/process.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import { isDeno } from "@veryfront/platform/compat/runtime.ts";

/**
 * Get environment variable cross-platform
 */
function getEnv(name: string): string | undefined {
  if (isDeno) {
    // @ts-ignore - Deno global
    return Deno.env?.get?.(name);
  }
  return process?.env?.[name];
}

/**
 * Configuration file structure (.veryfrontrc)
 */
export interface VeryfrontConfig {
  projectSlug?: string;
  /** List of project slugs for multi-project pull */
  projects?: string[];
  apiToken?: string;
  apiUrl?: string;
}

/**
 * Resolved configuration for CLI commands
 */
export interface ResolvedConfig {
  apiUrl: string;
  apiToken: string;
  projectSlug: string;
}

/**
 * Default API URL
 */
const DEFAULT_API_URL = "https://api.veryfront.com";

/**
 * Read .veryfrontrc configuration file from the project directory
 */
export async function readConfigFile(
  projectDir: string,
): Promise<VeryfrontConfig | null> {
  const fs = createFileSystem();
  const configPath = join(projectDir, ".veryfrontrc");

  try {
    if (!(await fs.exists(configPath))) {
      return null;
    }

    const content = await fs.readTextFile(configPath);
    return JSON.parse(content) as VeryfrontConfig;
  } catch {
    return null;
  }
}

/**
 * Infer project slug from directory name or package.json
 */
async function inferProjectSlug(projectDir: string): Promise<string | null> {
  const fs = createFileSystem();

  // Try to read package.json name field
  const packagePath = join(projectDir, "package.json");
  try {
    if (await fs.exists(packagePath)) {
      const content = await fs.readTextFile(packagePath);
      const pkg = JSON.parse(content) as { name?: string };
      if (pkg.name) {
        // Convert package name to slug format
        return pkg.name.replace(/^@[^/]+\//, "").replace(/[^a-z0-9-]/gi, "-");
      }
    }
  } catch {
    // Ignore errors
  }

  // Fall back to directory name
  const dirName = projectDir.split("/").pop() || projectDir.split("\\").pop();
  if (dirName) {
    return dirName.replace(/[^a-z0-9-]/gi, "-");
  }

  return null;
}

/**
 * Resolve full configuration from environment, config file, and defaults
 *
 * @param projectDir - The project directory (defaults to cwd)
 * @returns Resolved configuration or throws if required values are missing
 */
export async function resolveConfig(
  projectDir?: string,
): Promise<ResolvedConfig> {
  const dir = projectDir || cwd();
  const configFile = await readConfigFile(dir);

  // API URL: env var > config file > default
  const apiUrl = getEnv("VERYFRONT_API_URL") || configFile?.apiUrl || DEFAULT_API_URL;

  // API Token: env var > config file
  const apiToken = getEnv("VERYFRONT_API_TOKEN") || configFile?.apiToken;

  if (!apiToken) {
    throw new Error(
      "Missing API token. Set VERYFRONT_API_TOKEN environment variable or add apiToken to .veryfrontrc",
    );
  }

  // Project Slug: env var > config file > inferred
  let projectSlug: string | undefined = getEnv("VERYFRONT_PROJECT_SLUG") || configFile?.projectSlug;

  if (!projectSlug) {
    const inferred = await inferProjectSlug(dir);
    projectSlug = inferred ?? undefined;
  }

  if (!projectSlug) {
    throw new Error(
      "Could not determine project slug. Set VERYFRONT_PROJECT_SLUG environment variable or add projectSlug to .veryfrontrc",
    );
  }

  return {
    apiUrl,
    apiToken,
    projectSlug,
  };
}

/**
 * HTTP client for API requests with authentication
 */
export interface ApiClient {
  get<T>(path: string, params?: Record<string, string>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

/**
 * API error response
 */
export interface ApiError {
  error: string;
  message?: string;
  code?: string;
}

/**
 * Create an authenticated API client
 */
export function createApiClient(config: ResolvedConfig): ApiClient {
  const { apiUrl, apiToken } = config;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string>,
  ): Promise<T> {
    let url = `${apiUrl}${path}`;

    if (params && Object.keys(params).length > 0) {
      const queryString = new URLSearchParams(params).toString();
      url = `${url}?${queryString}`;
    }

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      let errorMessage = `API request failed: ${response.status} ${response.statusText}`;
      try {
        const errorBody = (await response.json()) as ApiError;
        errorMessage = errorBody.message || errorBody.error || errorMessage;
      } catch {
        // Ignore JSON parse errors
      }
      throw new Error(errorMessage);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  return {
    get: <T>(path: string, params?: Record<string, string>) =>
      request<T>("GET", path, undefined, params),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
    put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
    patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
    delete: <T>(path: string) => request<T>("DELETE", path),
  };
}
