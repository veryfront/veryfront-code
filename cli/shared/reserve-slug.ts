/**
 * Reserve project slug on the Veryfront API
 *
 * Handles slug conflicts by appending random suffixes
 *
 * @module cli/shared/reserve-slug
 */

import { type EnvironmentConfig, getEnvironmentConfig } from "veryfront/config";
import { capitalizeSeparatedWords } from "veryfront/utils/case-utils";
import { randomSuffix } from "#cli/shared/slug";

function slugToName(slug: string): string {
  return capitalizeSeparatedWords(slug, "-", " ");
}

export interface ReserveResult {
  slug: string;
  projectId: string;
  created: boolean;
}

interface ApiError {
  message?: string;
}

interface CreateProjectResult {
  success: boolean;
  projectId?: string;
  isSlugTaken?: boolean;
  error?: string;
}

const MAX_SLUG_ATTEMPTS = 10;

function getApiUrl(env: EnvironmentConfig = getEnvironmentConfig()): string {
  return env.apiUrl ?? "https://api.veryfront.com";
}

export async function reserveProjectSlug(
  slug: string,
  token: string,
  env: EnvironmentConfig = getEnvironmentConfig(),
): Promise<ReserveResult> {
  const name = slugToName(slug);
  let currentSlug = slug;

  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
    const result = await tryCreateProject(currentSlug, name, token, env);

    if (result.success) {
      return {
        slug: currentSlug,
        projectId: result.projectId ?? "",
        created: true,
      };
    }

    if (!result.isSlugTaken) {
      throw new Error(result.error ?? "Failed to create project");
    }

    currentSlug = `${slug}-${randomSuffix()}`;
  }

  throw new Error(`Could not find available slug after ${MAX_SLUG_ATTEMPTS} attempts`);
}

async function tryCreateProject(
  slug: string,
  name: string,
  token: string,
  env: EnvironmentConfig = getEnvironmentConfig(),
): Promise<CreateProjectResult> {
  try {
    const response = await fetch(`${getApiUrl(env)}/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ slug, name }),
    });

    if (response.ok) {
      const data = (await response.json()) as { id: string };
      return { success: true, projectId: data.id };
    }

    if (response.status === 409) {
      return { success: false, isSlugTaken: true };
    }

    const error = (await response.json().catch(() => ({}))) as ApiError;
    return { success: false, error: error.message ?? `HTTP ${response.status}` };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function isSlugAvailable(
  slug: string,
  token: string,
  env: EnvironmentConfig = getEnvironmentConfig(),
): Promise<boolean> {
  try {
    const response = await fetch(`${getApiUrl(env)}/projects/${slug}`, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${token}` },
    });

    return response.status === 404;
  } catch {
    return true;
  }
}
