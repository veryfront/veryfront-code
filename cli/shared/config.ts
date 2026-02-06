/**
 * Shared CLI configuration for pull/push commands
 *
 * Handles API URL, authentication tokens, and project resolution.
 * @module cli/shared/config
 */

import { z } from "zod";
import { join } from "#veryfront/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import {
  type EnvironmentConfig,
  getEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { cliLogger } from "#veryfront/utils";
import { readToken } from "../auth/token-store.ts";
import { ensureAuthenticated } from "../auth/login.ts";
import { DEFAULT_API_URL } from "./constants.ts";

export const VeryfrontConfigSchema = z.object({
  projectSlug: z.string().optional(),
  /** List of project slugs for multi-project pull */
  projects: z.array(z.string()).optional(),
  apiToken: z.string().optional(),
  apiUrl: z.string().optional(),
});
export type VeryfrontConfig = z.infer<typeof VeryfrontConfigSchema>;

export const ResolvedConfigSchema = z.object({
  apiUrl: z.string(),
  apiToken: z.string(),
  projectSlug: z.string(),
});
export type ResolvedConfig = z.infer<typeof ResolvedConfigSchema>;

export async function readConfigFile(projectDir: string): Promise<VeryfrontConfig | null> {
  const fs = createFileSystem();

  for (const ext of [".ts", ".js"]) {
    const configPath = join(projectDir, `veryfront.config${ext}`);

    try {
      if (!(await fs.exists(configPath))) continue;

      const module = await import(`file://${configPath}`);
      const config = module.default ?? module;

      if (config?.projectSlug) return { projectSlug: config.projectSlug };
    } catch (error) {
      cliLogger.debug(`Failed to import config file ${configPath}:`, error);
    }
  }

  const rcPath = join(projectDir, ".veryfrontrc");

  try {
    if (!(await fs.exists(rcPath))) return null;
    const content = await fs.readTextFile(rcPath);
    const parsed = VeryfrontConfigSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    cliLogger.debug(`Failed to read .veryfrontrc:`, error);
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
      const name = pkg.name?.replace(/^@[^/]+\//, "");
      if (name) return slugify(name);
    }
  } catch (error) {
    cliLogger.debug("Failed to read package.json for project slug:", error);
  }

  const dirName = projectDir.split(/[/\\]/).pop();
  return dirName ? slugify(dirName) : null;
}

async function resolveConfigBase(
  projectDir: string | undefined,
  env: EnvironmentConfig,
  interactive: boolean,
): Promise<ResolvedConfig> {
  const dir = projectDir ?? cwd();
  const configFile = await readConfigFile(dir);

  const apiUrl = env.apiUrl ?? configFile?.apiUrl ?? DEFAULT_API_URL;

  let apiToken = env.apiToken ?? configFile?.apiToken ?? (await readToken(env));

  if (!apiToken && interactive) {
    const userInfo = await ensureAuthenticated(env);
    if (!userInfo) throw new Error("Authentication required for this operation.");
    apiToken = (await readToken(env)) ?? null;
    if (!apiToken) throw new Error("Authentication failed. Please try again.");
  }

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

function createConfigResolver(interactive: boolean) {
  return (projectDir?: string, env?: EnvironmentConfig): Promise<ResolvedConfig> =>
    resolveConfigByMode(projectDir, env, interactive);
}

export const resolveConfig = createConfigResolver(false);

/**
 * Resolve config with interactive authentication.
 *
 * If no token is available, prompts the user to login interactively.
 * Use this for commands that require authentication (push, pull, deploy).
 */
export const resolveConfigWithAuth = createConfigResolver(true);

function resolveConfigByMode(
  projectDir: string | undefined,
  env: EnvironmentConfig | undefined,
  interactive: boolean,
): Promise<ResolvedConfig> {
  return resolveConfigBase(projectDir, env ?? getEnvironmentConfig(), interactive);
}

export interface ApiClient {
  get<T>(path: string, params?: Record<string, string>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

export const ApiErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  code: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export function createApiClient(config: ResolvedConfig): ApiClient {
  const { apiUrl, apiToken } = config;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${apiUrl}${path}`);

    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, value);
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
        const parsed = ApiErrorSchema.safeParse(await response.json());
        if (parsed.success) {
          errorMessage = parsed.data.message || parsed.data.error || errorMessage;
        }
      } catch {
        // Keep default error message if JSON parsing fails
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
