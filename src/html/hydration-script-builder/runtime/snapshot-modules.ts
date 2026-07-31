/**
 * Importing modules that are bound to a dependency snapshot.
 *
 * When the server evicts the snapshot a page was rendered against, every pinned
 * module URL starts answering 409. A foreground import recovers by reloading
 * the document once; a speculative prefetch must not, so it reports the
 * conflict instead and lets the caller drop its cache entry.
 */

import type { ModuleNamespace, RuntimeFetchInit, RuntimeResponse } from "./env.ts";

const RECOVERY_STATE_KEY = "__VF_DEPENDENCY_SNAPSHOT_RECOVERY_STARTED__";

export interface SnapshotModuleDeps {
  importModule: (moduleUrl: string) => Promise<ModuleNamespace>;
  fetchModule: (url: string, init?: RuntimeFetchInit) => Promise<RuntimeResponse>;
  reloadDocument: () => void;
  /** Where the "already reloading" flag lives; `window` in the browser. */
  recoveryState: Record<string, unknown>;
}

export interface SnapshotModuleImporter {
  importSnapshotBoundModule(
    moduleUrl: string,
    allowDocumentReload?: boolean,
  ): Promise<ModuleNamespace>;
  recoverFromSnapshotBoundModuleFailure(
    moduleUrl: string,
    allowDocumentReload?: boolean,
  ): Promise<boolean>;
}

export interface DependencySnapshotConflictError extends Error {
  dependencySnapshotConflict?: boolean;
}

/** The two bodies the module server returns for an unknown snapshot. */
export async function isDependencySnapshotConflictResponse(
  response: RuntimeResponse | null | undefined,
): Promise<boolean> {
  if (!response || response.status !== 409) return false;

  try {
    const clone = response.clone?.() ?? response;
    const body = (await clone.text?.() ?? "").trim();
    return body === "Unknown dependency snapshot" ||
      body === "export default null; // Unknown dependency snapshot";
  } catch (_) {
    return false;
  }
}

export function createSnapshotModuleImporter(deps: SnapshotModuleDeps): SnapshotModuleImporter {
  async function recoverFromSnapshotBoundModuleFailure(
    moduleUrl: string,
    allowDocumentReload = true,
  ): Promise<boolean> {
    try {
      const parsedUrl = new URL(moduleUrl, "http://veryfront.local");
      const snapshotKeys = parsedUrl.searchParams.getAll("pins");
      const pathMatch = parsedUrl.pathname.match(
        /^\/_vf_modules\/_pins\/([^/]+)(?:\/|$)/,
      );
      if (pathMatch) {
        try {
          snapshotKeys.push(decodeURIComponent(pathMatch[1] as string));
        } catch (_) {
          return false;
        }
      }
      if (
        snapshotKeys.length !== 1 ||
        !/^on:[A-Za-z0-9._-]+$/.test(snapshotKeys[0] as string)
      ) return false;

      const response = await deps.fetchModule(moduleUrl, { cache: "no-store" });
      if (!(await isDependencySnapshotConflictResponse(response))) return false;
      if (!allowDocumentReload) return true;

      if (deps.recoveryState[RECOVERY_STATE_KEY] === true) return true;

      deps.recoveryState[RECOVERY_STATE_KEY] = true;
      try {
        deps.reloadDocument();
      } catch (_) {
        delete deps.recoveryState[RECOVERY_STATE_KEY];
        return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  async function importSnapshotBoundModule(
    moduleUrl: string,
    allowDocumentReload = true,
  ): Promise<ModuleNamespace> {
    try {
      return await deps.importModule(moduleUrl);
    } catch (error) {
      const snapshotConflict = await recoverFromSnapshotBoundModuleFailure(
        moduleUrl,
        allowDocumentReload,
      );
      if (snapshotConflict && !allowDocumentReload) {
        const conflictError = new Error(
          "Dependency snapshot is unavailable during speculative module prefetch",
        ) as DependencySnapshotConflictError;
        conflictError.name = "DependencySnapshotConflictError";
        conflictError.dependencySnapshotConflict = true;
        conflictError.cause = error;
        throw conflictError;
      }
      throw error;
    }
  }

  return { importSnapshotBoundModule, recoverFromSnapshotBoundModuleFailure };
}

export function isDependencySnapshotConflict(error: unknown): boolean {
  return Boolean((error as DependencySnapshotConflictError | null)?.dependencySnapshotConflict);
}
