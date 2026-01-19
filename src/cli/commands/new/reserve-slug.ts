/**
 * Reserve project slug on the Veryfront API
 *
 * Handles slug conflicts by auto-incrementing (e.g., my-app-2)
 *
 * @module cli/commands/new/reserve-slug
 */

import { getRuntimeEnv, type RuntimeEnv } from "#veryfront/config/runtime-env.ts";

// ============================================================================
// Types
// ============================================================================

export interface ReserveResult {
  slug: string;
  projectId: string;
  created: boolean;
}

interface ApiError {
  message?: string;
  code?: string;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_SLUG_ATTEMPTS = 10;

function getApiUrl(env: RuntimeEnv = getRuntimeEnv()): string {
  return env.apiUrl || "https://api.veryfront.com";
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Reserve a project slug on the API.
 * If the slug is taken, tries incrementing (my-app-2, my-app-3, etc.)
 *
 * @param slug - Desired project slug
 * @param token - API authentication token
 * @param env - Runtime environment (for testing)
 * @returns Reserve result with actual slug used
 */
export async function reserveProjectSlug(
  slug: string,
  token: string,
  env: RuntimeEnv = getRuntimeEnv(),
): Promise<ReserveResult> {
  let currentSlug = slug;
  let attempt = 1;

  while (attempt <= MAX_SLUG_ATTEMPTS) {
    const result = await tryCreateProject(currentSlug, token, env);

    if (result.success) {
      return {
        slug: currentSlug,
        projectId: result.projectId!,
        created: true,
      };
    }

    // If slug is taken, try with increment
    if (result.isSlugTaken) {
      attempt++;
      currentSlug = `${slug}-${attempt}`;
      continue;
    }

    // Other error - throw
    throw new Error(result.error || "Failed to create project");
  }

  throw new Error(`Could not find available slug after ${MAX_SLUG_ATTEMPTS} attempts`);
}

// ============================================================================
// API Helpers
// ============================================================================

interface CreateProjectResult {
  success: boolean;
  projectId?: string;
  isSlugTaken?: boolean;
  error?: string;
}

/**
 * Try to create a project with the given slug.
 * Returns success status and whether the slug was taken.
 */
async function tryCreateProject(
  slug: string,
  token: string,
  env: RuntimeEnv = getRuntimeEnv(),
): Promise<CreateProjectResult> {
  try {
    const response = await fetch(`${getApiUrl(env)}/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ slug, name: slug }),
    });

    if (response.ok) {
      const data = await response.json() as { id: string };
      return {
        success: true,
        projectId: data.id,
      };
    }

    // Check if slug is taken (409 Conflict)
    if (response.status === 409) {
      return {
        success: false,
        isSlugTaken: true,
      };
    }

    // Other error
    const error = await response.json().catch(() => ({})) as ApiError;
    return {
      success: false,
      error: error.message || `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Testing Helpers
// ============================================================================

/**
 * Check if a slug is available without creating the project.
 * Useful for validation before showing optimistic URLs.
 */
export async function isSlugAvailable(
  slug: string,
  token: string,
  env: RuntimeEnv = getRuntimeEnv(),
): Promise<boolean> {
  try {
    const response = await fetch(`${getApiUrl(env)}/projects/${slug}`, {
      method: "HEAD",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    // 404 means slug is available
    return response.status === 404;
  } catch {
    // On error, assume available (optimistic)
    return true;
  }
}
