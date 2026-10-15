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
