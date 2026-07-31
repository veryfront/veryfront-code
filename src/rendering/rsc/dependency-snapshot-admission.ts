import { isCanonicalDependencyPinningCacheKey } from "#veryfront/cache/keys/dependency-pinning.ts";
import { recoverFromDependencySnapshotAdmissionFailure } from "./dependency-snapshot-recovery.ts";

export interface DependencySnapshotAdmissionInput {
  readonly requestedDependencyPinningCacheKey: unknown;
  readonly currentDependencyPinningCacheKey: unknown;
  readonly responseHeaderDependencyPinningCacheKey?: unknown;
  readonly responseBodyDependencyPinningCacheKey?: unknown;
  readonly requireResponseHeader?: boolean;
  readonly requireResponseBody?: boolean;
}

export interface AdmittedDependencySnapshot {
  readonly dependencyPinningCacheKey: string;
}

export type RecoverFromDependencySnapshotAdmissionFailure = () => boolean;

export class DependencySnapshotAdmissionError extends Error {
  override readonly name = "DependencySnapshotAdmissionError";

  constructor() {
    super("Dependency snapshot admission failed");
  }
}

interface NormalizedResponseAuthority {
  readonly present: boolean;
  readonly dependencyPinningCacheKey: string;
}

function normalizeExpectedAuthority(value: unknown): string | null {
  if (value === undefined || value === null || value === "off") return "off";
  return typeof value === "string" && isCanonicalDependencyPinningCacheKey(value) ? value : null;
}

function normalizeResponseAuthority(
  value: unknown,
): NormalizedResponseAuthority | null {
  if (value === undefined || value === null) {
    return { present: false, dependencyPinningCacheKey: "off" };
  }
  if (value === "off") {
    return { present: true, dependencyPinningCacheKey: "off" };
  }
  return typeof value === "string" && isCanonicalDependencyPinningCacheKey(value)
    ? { present: true, dependencyPinningCacheKey: value }
    : null;
}

function rejectAdmission(
  recoverFromAdmissionFailure: RecoverFromDependencySnapshotAdmissionFailure,
): null {
  try {
    recoverFromAdmissionFailure();
  } catch {
    // The admission decision remains fail-closed even when reload is unavailable.
  }
  return null;
}

/**
 * Admit one immutable dependency identity before a response can affect the
 * document. The request-time hydration snapshot is the authority: current DOM
 * state and every applicable response channel must still agree with it.
 */
export function admitDependencySnapshot(
  input: DependencySnapshotAdmissionInput,
  recoverFromAdmissionFailure: RecoverFromDependencySnapshotAdmissionFailure =
    recoverFromDependencySnapshotAdmissionFailure,
): AdmittedDependencySnapshot | null {
  const requested = normalizeExpectedAuthority(
    input.requestedDependencyPinningCacheKey,
  );
  const current = normalizeExpectedAuthority(
    input.currentDependencyPinningCacheKey,
  );
  if (requested === null || current === null || current !== requested) {
    return rejectAdmission(recoverFromAdmissionFailure);
  }

  const responseAuthorities = [
    {
      authority: normalizeResponseAuthority(
        input.responseHeaderDependencyPinningCacheKey,
      ),
      required: input.requireResponseHeader === true,
    },
    {
      authority: normalizeResponseAuthority(
        input.responseBodyDependencyPinningCacheKey,
      ),
      required: input.requireResponseBody === true,
    },
  ] as const;

  for (const { authority, required } of responseAuthorities) {
    if (
      authority === null ||
      (requested !== "off" && required && !authority.present) ||
      (authority.present && authority.dependencyPinningCacheKey !== requested)
    ) {
      return rejectAdmission(recoverFromAdmissionFailure);
    }
  }

  return Object.freeze({ dependencyPinningCacheKey: requested });
}
