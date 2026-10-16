import { setEnv } from "#cli/process-env";
import { refreshEnvironmentConfig } from "#cli/environment-config";
import type { DeployControlPlane } from "../../shared/deployment/control-plane.ts";
import { readProjectLinkForControlPlane, writeProjectLink } from "../../shared/project-link.ts";
import { projectApiReference } from "../../shared/project-resolution.ts";
import { createHttpDeployControlPlane } from "../../shared/deployment/control-plane.ts";
import { createApiClient, type ResolvedConfig } from "#cli/shared/config";
import { createCloudOnboardingTransport } from "../../shared/cloud-onboarding-transport.ts";
import { DEFAULT_API_URL } from "../../shared/constants.ts";

const CONNECTED_DEV_SHUTDOWN_TIMEOUT_MS = 75_000;
/** Admission preflight for a directory that explicitly names a Cloud project. */
export interface ConnectedDevTarget {
  projectId: string;
  projectSlug: string;
  environmentId: string;
  environmentName: string;
}

export async function prepareConnectedDev(
  projectSlug: string | undefined,
  environmentName: string,
  dependencies: {
    authenticate(): Promise<boolean>;
    resolve(projectSlug: string, environmentName: string): Promise<ConnectedDevTarget>;
  },
  proxyMode = false,
): Promise<ConnectedDevTarget | undefined> {
  if (proxyMode || !projectSlug) return undefined;
  if (!await dependencies.authenticate()) {
    throw new Error(
      "Veryfront Cloud login is required for this linked project. Run veryfront login, then npm run dev again.",
    );
  }
  return await dependencies.resolve(projectSlug, environmentName);
}

/** Qualified credentials without an override target the official API. */
export function connectedDevApiBaseUrl(apiBaseUrl?: string): string {
  return apiBaseUrl ?? DEFAULT_API_URL;
}

/** Release every owned service even if one cleanup fails. */
export async function stopDevServices(
  cleanups: Array<() => void | Promise<void>>,
  shutdown?: { connected: boolean; forceExit(): void },
): Promise<void> {
  // Connected cleanup drains pending admission/events before terminal persistence;
  // renewal, pending append, final flush and completion can each take 15 seconds.
  // Leave additional time for scheduling before reporting an incomplete shutdown.
  const timeout = shutdown
    ? setTimeout(
      () => shutdown.forceExit(),
      shutdown.connected ? CONNECTED_DEV_SHUTDOWN_TIMEOUT_MS : 3_000,
    )
    : undefined;
  try {
    const results = await Promise.allSettled(
      cleanups.map((cleanup) => Promise.resolve().then(cleanup)),
    );
    const errors = results.filter((result): result is PromiseRejectedResult =>
      result.status === "rejected"
    ).map((result) => result.reason);
    if (errors.length) {
      throw new AggregateError(errors, "Some local development services could not stop cleanly.");
    }
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/** Keep connected preflight on the host transport after project config executes. */
export function createConnectedDevControlPlane(
  config: ResolvedConfig,
  options: { timeoutMs?: number } = {},
) {
  return createHttpDeployControlPlane(
    config,
    createApiClient(config, createCloudOnboardingTransport(config.apiUrl, options.timeoutMs)),
  );
}

/** Keep the local runtime and readiness link on the connected API's Studio. */
export function connectedDevStudioBaseUrl(apiBaseUrl: string, studioUrl?: string): string {
  if (studioUrl) return studioUrl;
  const hostname = new URL(apiBaseUrl).hostname;
  if (["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
    return "http://localhost:3000";
  }
  if (hostname === "api.veryfront.com") return "https://veryfront.com";
  if (hostname === "api.veryfront.org") return "https://veryfront.org";
  throw new Error(
    `Cannot determine Studio for connected API "${apiBaseUrl}". Set STUDIO_URL to your Studio origin and run npm run dev again.`,
  );
}

/** Resolve directory-owned identity before accepting a mutable Cloud slug. */
export async function resolveConnectedDevProject(
  controlPlane: Pick<DeployControlPlane, "getProject">,
  projectDir: string,
  config: ResolvedConfig,
) {
  const link = await readProjectLinkForControlPlane(projectDir, config.apiUrl);
  const matchesLink = link && (link.projectSlug === config.projectSlug ||
    link.previousProjectSlugs?.includes(config.projectSlug));
  const projectId = matchesLink ? link.projectId : config.projectId;
  const project = await controlPlane.getProject(projectApiReference({ ...config, projectId }));
  if (matchesLink && link.projectSlug !== project.slug) {
    await writeProjectLink(projectDir, {
      controlPlane: link.controlPlane,
      projectId: link.projectId,
      projectSlug: project.slug,
      previousProjectSlugs: [...new Set([...(link.previousProjectSlugs ?? []), link.projectSlug])],
    });
  }
  return project;
}

export function applyConnectedDevProjectSlug<T extends { projectSlug?: string }>(
  context: T,
  projectSlug: string,
): T {
  setEnv("VERYFRONT_PROJECT_SLUG", projectSlug);
  refreshEnvironmentConfig();
  return { ...context, projectSlug };
}
