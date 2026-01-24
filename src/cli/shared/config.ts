/**
 * Shared CLI configuration for pull/push commands
 *
 * Handles API URL, authentication tokens, and project resolution.
 * @module cli/shared/config
 */

import { join } from "#veryfront/platform/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { getRuntimeEnv, type RuntimeEnv } from "#veryfront/config/runtime-env.ts";
import { readToken } from "../auth/token-store.ts";

export interface VeryfrontConfig {
  projectSlug?: string;
  /** List of project slugs for multi-project pull */
  projects?: string[];
  apiToken?: string;
  apiUrl?: string;
}

export interface ResolvedConfig {
  apiUrl: string;
  apiToken: string;
  projectSlug: string;
}

const DEFAULT_API_URL = "https://api.veryfront.com";

export async function readConfigFile(projectDir: string): Promise<VeryfrontConfig | null> {
  const fs = createFileSystem();

  for (const ext of [".ts", ".js"]) {
    const configPath = join(projectDir, `veryfront.config${ext}`);
    try {
      if (!(await fs.exists(configPath))) continue;

      const module = await import(`file://${configPath}`);
      const config = module.default ?? module;

      if (config?.projectSlug) return { projectSlug: config.projectSlug };
    } catch {
      // Ignore import errors, try next format
    }
  }

  const rcPath = join(projectDir, ".veryfrontrc");
  try {
    if (!(await fs.exists(rcPath))) return null;
    const content = await fs.readTextFile(rcPath);
    return JSON.parse(content) as VeryfrontConfig;
  } catch {
    return null;
  }
}

function slugify(value: string): string {
  return value.replace(/[^a-z0-9-]/gi, "-");
}

async function inferProjectSlug(projectDir: string): Promise<string | null> {
  const fs = createFileSystem();
  const packagePath = join(projectDir, "package.json");

  try {
    if (await fs.exists(packagePath)) {
      const content = await fs.readTextFile(packagePath);
      const pkg = JSON.parse(content) as { name?: string };
      if (pkg.name) return slugify(pkg.name.replace(/^@[^/]+\//, ""));
    }
  } catch {
    // Ignore errors
  }

  const dirName = projectDir.split(/[/\\]/).pop();
  return dirName ? slugify(dirName) : null;
}

export async function resolveConfig(
  projectDir?: string,
  env: RuntimeEnv = getRuntimeEnv(),
): Promise<ResolvedConfig> {
  const dir = projectDir ?? cwd();
  const configFile = await readConfigFile(dir);

  const apiUrl = env.apiUrl ?? configFile?.apiUrl ?? DEFAULT_API_URL;

  const apiToken = env.apiToken ?? configFile?.apiToken ?? (await readToken());
  if (!apiToken) {
    throw new Error(
      "Missing API token. Run 'veryfront login' or set VERYFRONT_API_TOKEN environment variable",
    );
  }

  const projectSlug = env.projectSlug ?? configFile?.projectSlug ?? (await inferProjectSlug(dir));
  if (!projectSlug) {
    throw new Error(
      "Could not determine project slug. Set VERYFRONT_PROJECT_SLUG environment variable or add projectSlug to veryfront.config.ts",
    );
  }

  return { apiUrl, apiToken, projectSlug };
}

export interface ApiClient {
  get<T>(path: string, params?: Record<string, string>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

export interface ApiError {
  error: string;
  message?: string;
  code?: string;
}

export function createApiClient(config: ResolvedConfig): ApiClient {
  const { apiUrl, apiToken } = config;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${apiUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString(), {
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

    if (response.status === 204) return undefined as T;

    return response.json() as Promise<T>;
  }

  return {
    get<T>(path: string, params?: Record<string, string>): Promise<T> {
      return request<T>("GET", path, undefined, params);
    },
    post<T>(path: string, body?: unknown): Promise<T> {
      return request<T>("POST", path, body);
    },
    put<T>(path: string, body?: unknown): Promise<T> {
      return request<T>("PUT", path, body);
    },
    patch<T>(path: string, body?: unknown): Promise<T> {
      return request<T>("PATCH", path, body);
    },
    delete<T>(path: string): Promise<T> {
      return request<T>("DELETE", path);
    },
  };
}
