import {
  materializeAuthenticatedRecoverySuffix,
  readAuthenticatedRecoverySuffix,
} from "./recovery-suffix.ts";
import { parseRecoverySnapshot } from "./recovery-snapshot.ts";
import {
  createManagedRecoveryWriter,
  type RecoveryEventAppend,
} from "./managed-recovery-writer.ts";
import type { AdmitExecutorToolCall } from "#veryfront/runtime/tool-call-admission-dispatch.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import { join } from "node:path";
import {
  getVerifiedControlPlaneRecoveryAdmission,
  type VerifiedControlPlaneRequestClaims,
} from "./control-plane-auth.ts";
import { getRecoverySourceBindingSchema } from "./recovery-admission-schema.ts";
import { createRecoverySourceManifest } from "./recovery-source-manifest.ts";
import { RecoverySessionOwner } from "./recovery-session-owner.ts";
import type { DurableRunIdentity } from "./durable-run-home-schema.ts";
import type { ManagedRecoveryOwnerFactory } from "./session-manager.ts";

/**
 * Boot-time composition only. Capture these functions from the trusted release
 * provider and API transport before project evaluation; never from request props,
 * a project adapter override, or a mutable environment/latest-release lookup.
 * This factory does not enable discovery or advertise recovery capability.
 */
export function createManagedRecoveryHostFactory(input: {
  readRecoverySuffixPage?: (claims: VerifiedControlPlaneRequestClaims, request: {
    afterEventId: number;
    throughEventId: number;
    throughExternalSequence: number;
    limit: number;
  }) => Promise<unknown>;
  createEventAppender?: (claims: VerifiedControlPlaneRequestClaims) => Promise<RecoveryEventAppend>;
  createToolAdmissionBinder?: (
    claims: VerifiedControlPlaneRequestClaims,
  ) => (callback: AdmitExecutorToolCall) => void;
  sourceBinding: unknown;
  durableDirectory: string;
  listImmutableReleaseFiles: (
    claims: VerifiedControlPlaneRequestClaims,
  ) => Promise<{ sourceBinding: unknown; files: unknown }>;
  validateCurrentOwnership: (claims: VerifiedControlPlaneRequestClaims) => Promise<unknown>;
  loadAcknowledgedSnapshot: (
    identity: DurableRunIdentity,
  ) => Promise<unknown | undefined>;
}): ManagedRecoveryOwnerFactory {
  const sourceSchema = getRecoverySourceBindingSchema();
  const sourceBinding = Object.freeze(sourceSchema.parse(input.sourceBinding));
  const directory = input.durableDirectory;
  const listFiles = input.listImmutableReleaseFiles;
  const validateOwnership = input.validateCurrentOwnership;
  const loadSnapshot = input.loadAcknowledgedSnapshot;
  const readSuffixPage = input.readRecoverySuffixPage;
  return async ({ claims, awaitRetiredPreviousOwner }) => {
    const admission = getVerifiedControlPlaneRecoveryAdmission(claims);
    if (
      !admission || admission.sourceBinding.projectId !== claims.project_id ||
      privateJsonStringify(admission.sourceBinding) !== privateJsonStringify(sourceBinding)
    ) {
      throw new Error("Managed recovery does not match the trusted source host release");
    }
    const listing = await listFiles(claims);
    const listedBinding = sourceSchema.parse(listing.sourceBinding);
    if (
      privateJsonStringify(listedBinding) !== privateJsonStringify(sourceBinding) ||
      createRecoverySourceManifest(listing.files).hash !== admission.identity.sourceHash
    ) {
      throw new Error("Managed recovery immutable release source does not match");
    }
    const owner = await RecoverySessionOwner.acquire({
      claims,
      directory: join(directory, admission.identity.canonicalRunId),
      validateCurrentOwnership: () => validateOwnership(claims),
      awaitRetiredPreviousOwner,
    });
    let snapshot = await loadSnapshot(admission.identity);
    if (readSuffixPage && (snapshot !== undefined || owner.requiresRestoredSnapshot)) {
      const parsed = snapshot === undefined ? undefined : parseRecoverySnapshot(snapshot);
      const suffix = await readAuthenticatedRecoverySuffix({
        snapshot: parsed,
        claims,
        readPage: (request) => readSuffixPage(claims, request),
        assertCurrentOwnership: () => owner.assertCurrentOwnership(),
      });
      snapshot = materializeAuthenticatedRecoverySuffix({ snapshot: suffix.snapshot, suffix });
    }
    const restoredSnapshot = snapshot === undefined
      ? undefined
      : await owner.validateRestoredSnapshot(snapshot);
    const writer = input.createEventAppender && input.createToolAdmissionBinder
      ? await createManagedRecoveryWriter({
        claims,
        owner,
        directory,
        append: await input.createEventAppender(claims),
        bindAdmissionWriter: input.createToolAdmissionBinder(claims),
        ...(restoredSnapshot ? { restoredSnapshot } : {}),
      })
      : undefined;
    return {
      owner,
      ...(snapshot === undefined ? {} : { snapshot }),
      ...(writer ? { writer } : {}),
    };
  };
}
