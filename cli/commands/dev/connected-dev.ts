import { withOnboardingDeadline } from "../../shared/onboarding-fetch.ts";
import { createHttpDeployControlPlane } from "../../shared/deployment/control-plane.ts";
import { createApiClient, type ResolvedConfig } from "#cli/shared/config";
import { createVeryfrontApiOriginBoundOutboundFetch } from "#cli/outbound-fetch";
import { DEFAULT_API_URL } from "../../shared/constants.ts";
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
export async function stopDevServices(cleanups: Array<() => void | Promise<void>>): Promise<void> {
  const results = await Promise.allSettled(
    cleanups.map((cleanup) => Promise.resolve().then(cleanup)),
  );
  const errors = results.filter((result): result is PromiseRejectedResult =>
    result.status === "rejected"
  ).map((result) => result.reason);
  if (errors.length) {
    throw new AggregateError(errors, "Some local development services could not stop cleanly.");
  }
}

/** Keep connected preflight on the host transport after project config executes. */
export function createConnectedDevControlPlane(
  config: ResolvedConfig,
  options: { timeoutMs?: number } = {},
) {
  return createHttpDeployControlPlane(
    config,
    createApiClient(
      config,
      withOnboardingDeadline(
        createVeryfrontApiOriginBoundOutboundFetch(config.apiUrl),
        options.timeoutMs,
      ),
    ),
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
