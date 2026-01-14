/**
 * Reserve project slug on the Veryfront API
 *
 * Handles slug conflicts by auto-incrementing (e.g., my-app-2)
 *
 * @module cli/commands/new/reserve-slug
 */

import { getEnv } from "@veryfront/platform/compat/process.ts";

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

function getApiUrl(): string {
  return getEnv("VERYFRONT_API_URL") || "https://api.veryfront.com";
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
 * @returns Reserve result with actual slug used
 */
export async function reserveProjectSlug(
  slug: string,
  token: string,
): Promise<ReserveResult> {
  let currentSlug = slug;
  let attempt = 1;

  while (attempt <= MAX_SLUG_ATTEMPTS) {
    const result = await tryCreateProject(currentSlug, token);

    if (result.success) {
      // Delete template files that API auto-creates
      await clearProjectFiles(currentSlug, token);

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
): Promise<CreateProjectResult> {
  try {
    const response = await fetch(`${getApiUrl()}/projects`, {
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
// File Management
// ============================================================================

/**
 * Clear all files from a project's main branch.
 * Used to remove auto-created template files after project creation.
 */
async function clearProjectFiles(slug: string, token: string): Promise<void> {
  try {
    // Get list of files on main branch
    const listResponse = await fetch(
      `${getApiUrl()}/projects/${slug}/files?branch=main`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
    );

    if (!listResponse.ok) return;

    const data = (await listResponse.json()) as { data: Array<{ path: string }> };
    const files = data.data || [];

    // Delete each file (in parallel, max 10 at a time)
    const deleteFile = async (path: string) => {
      await fetch(
        `${getApiUrl()}/projects/${slug}/files/${encodeURIComponent(path)}?branch=main`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
    };

    // Process in batches to avoid overwhelming the API
    const batchSize = 10;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      await Promise.all(batch.map((f) => deleteFile(f.path)));
    }
  } catch (error) {
    throw new Error(
      `Failed to clear template files: ${error instanceof Error ? error.message : error}`,
    );
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
): Promise<boolean> {
  try {
    const response = await fetch(`${getApiUrl()}/projects/${slug}`, {
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
