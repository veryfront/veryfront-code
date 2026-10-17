import { isAbsolute, join } from "node:path";
import { lstatSync } from "node:fs";
import { getHostBootEnv } from "#veryfront/platform/compat/process/env.ts";
import { getRecoverySourceBindingSchema } from "./recovery-admission-schema.ts";
import { createManagedRecoveryHostFactory } from "./managed-recovery-host.ts";
import { createManagedRecoveryHttpTransport } from "./managed-recovery-http.ts";
import { DurableRunHome } from "./durable-run-home.ts";
import { parseRecoverySnapshot } from "./recovery-snapshot.ts";
import type { ManagedRecoveryOwnerFactory } from "./session-manager.ts";

export function readManagedRecoveryBootConfig(
  read: (key: Parameters<typeof getHostBootEnv>[0]) => string | undefined,
) {
  const enabled = read("VERYFRONT_MANAGED_RECOVERY_ENABLED");
  if (enabled !== undefined && enabled !== "true" && enabled !== "false") {
    throw new Error("Managed recovery boot flag must be true or false");
  }
  const directory = read("VERYFRONT_MANAGED_RECOVERY_DIRECTORY");
  const projectId = read("VERYFRONT_MANAGED_RECOVERY_SOURCE_PROJECT_ID");
  const environmentId = read("VERYFRONT_MANAGED_RECOVERY_SOURCE_ENVIRONMENT_ID");
  const releaseId = read("VERYFRONT_MANAGED_RECOVERY_SOURCE_RELEASE_ID");
  const configured = [directory, projectId, environmentId, releaseId].some((value) =>
    value !== undefined
  );
  if (enabled !== "true" && !configured) return undefined;
  const sourceBinding = getRecoverySourceBindingSchema().parse({
    projectId,
    environmentId,
    releaseId,
  });
  if (!directory || !isAbsolute(directory)) {
    throw new Error("Managed recovery requires an absolute durable root");
  }
  if (enabled !== "true") return undefined;
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Managed recovery requires a trusted mounted directory");
  }
  const apiOrigin = read("VERYFRONT_API_BASE_URL") ?? read("VERYFRONT_API_URL") ??
    "https://api.veryfront.com";
  return Object.freeze({ directory, sourceBinding: Object.freeze(sourceBinding), apiOrigin });
}

let initialized = false;
let bootFactory: ManagedRecoveryOwnerFactory | undefined;

/** Called exactly once while the global runtime manager is built, before project evaluation. */
export function getBootManagedRecoveryFactory(): ManagedRecoveryOwnerFactory | undefined {
  if (initialized) return bootFactory;
  const config = readManagedRecoveryBootConfig(getHostBootEnv);
  if (config) {
    const transport = createManagedRecoveryHttpTransport(config.apiOrigin);
    bootFactory = createManagedRecoveryHostFactory({
      createEventAppender: transport.createEventAppender,
      readRecoverySuffixPage: transport.readRecoverySuffixPage,
      createToolAdmissionBinder: transport.createToolAdmissionBinder,
      sourceBinding: config.sourceBinding,
      durableDirectory: config.directory,
      listImmutableReleaseFiles: transport.listImmutableReleaseFiles,
      validateCurrentOwnership: transport.readOwnership,
      loadAcknowledgedSnapshot: async (identity) => {
        const home = await DurableRunHome.open({
          directory: join(config.directory, `${identity.canonicalRunId}.snapshot`),
          identity,
        });
        const stored = (await home.read()).at(-1);
        return stored ? parseRecoverySnapshot(stored.value) : undefined;
      },
    });
  }
  initialized = true;
  return bootFactory;
}
