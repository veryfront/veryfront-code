const UNKNOWN_DEPENDENCY_SNAPSHOT_BODY = "Unknown dependency snapshot";
const UNKNOWN_DEPENDENCY_SNAPSHOT_ERROR_MODULE =
  "export default null; // Unknown dependency snapshot";
const RECOVERY_STARTED_KEY = "__VF_DEPENDENCY_SNAPSHOT_RECOVERY_STARTED__";

type RecoveryGlobal = typeof globalThis & {
  [RECOVERY_STARTED_KEY]?: boolean;
};

function recoveryGlobal(): RecoveryGlobal {
  return globalThis as RecoveryGlobal;
}

export function recoverFromDependencySnapshotAdmissionFailure(
  reloadDocument: () => void = () => globalThis.location.reload(),
): boolean {
  const global = recoveryGlobal();
  if (global[RECOVERY_STARTED_KEY]) return true;

  global[RECOVERY_STARTED_KEY] = true;
  try {
    reloadDocument();
  } catch (_) {
    delete global[RECOVERY_STARTED_KEY];
    return false;
  }
  return true;
}

async function isDependencySnapshotConflict(response: Response): Promise<boolean> {
  if (response.status !== 409) return false;

  try {
    const body = (await response.clone().text()).trim();
    return body === UNKNOWN_DEPENDENCY_SNAPSHOT_BODY ||
      body === UNKNOWN_DEPENDENCY_SNAPSHOT_ERROR_MODULE;
  } catch (_) {
    return false;
  }
}

export async function recoverFromDependencySnapshotConflict(
  response: Response,
  reloadDocument: () => void = () => globalThis.location.reload(),
): Promise<boolean> {
  if (!(await isDependencySnapshotConflict(response))) return false;
  return recoverFromDependencySnapshotAdmissionFailure(reloadDocument);
}

export async function recoverFromSnapshotBoundModuleFailure(
  moduleUrl: string,
  fetchModule: typeof fetch = globalThis.fetch,
  reloadDocument: () => void = () => globalThis.location.reload(),
): Promise<boolean> {
  try {
    const pins = new URL(moduleUrl, "http://veryfront.local").searchParams.getAll("pins");
    if (pins.length !== 1 || !pins[0]?.startsWith("on:")) return false;

    const response = await fetchModule(moduleUrl, { cache: "no-store" });
    return await recoverFromDependencySnapshotConflict(response, reloadDocument);
  } catch (_) {
    return false;
  }
}

export function __resetDependencySnapshotRecoveryForTests(): void {
  delete recoveryGlobal()[RECOVERY_STARTED_KEY];
}
