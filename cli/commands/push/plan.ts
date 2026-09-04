import { computeContentDigest, type SyncFileSnapshot } from "../../sync/state.ts";

export interface PushFileContent {
  path: string;
  content: string;
}

export interface PushRemoteFile {
  path: string;
  content?: string;
  version_id?: string;
}

export interface PlannedUpload extends PushFileContent {
  expectedVersionId?: string;
  expectedAbsent?: boolean;
}

export interface PlannedDelete {
  path: string;
  expectedVersionId?: string;
}

export interface PushChangePlan {
  uploads: PlannedUpload[];
  deletes: PlannedDelete[];
  conflicts: string[];
  nextFiles: Record<string, SyncFileSnapshot>;
}

export interface PlanPushChangesOptions {
  localFiles: readonly PushFileContent[];
  remoteFiles: readonly PushRemoteFile[];
  baselineFiles: Readonly<Record<string, SyncFileSnapshot>>;
  deletePaths: readonly string[];
  /**
   * Protected remote paths selected for unconditional cleanup during prune.
   * Only entries that also appear in {@link PlanPushChangesOptions.deletePaths}
   * are honoured: a protected path outside that set would be dropped from the
   * sync baseline without ever being queued for deletion.
   */
  protectedDeletePaths?: readonly string[];
  force: boolean;
  /** Treat the exact remote snapshot as the baseline for a newly created branch. */
  remoteFilesAreBaseline?: boolean;
}

/** Explicit form of the comparator-less sort: UTF-16 code-unit order. */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function requiredVersionId(file: PushRemoteFile): string {
  if (file.version_id) return file.version_id;
  throw new Error(
    `Veryfront did not return a version ID for "${file.path}". The CLI cannot safely push this file. Run veryfront pull and try again.`,
  );
}

function requiredContent(file: PushRemoteFile): string {
  if (typeof file.content === "string") return file.content;
  throw new Error(
    `Veryfront returned invalid content for remote file "${file.path}". No files were pushed.`,
  );
}

export async function planPushChanges(
  options: PlanPushChangesOptions,
): Promise<PushChangePlan> {
  const requestedDeletePaths = new Set(options.deletePaths);
  const protectedDeletePaths = new Set(
    (options.protectedDeletePaths ?? []).filter((path) => requestedDeletePaths.has(path)),
  );
  const remoteByPath = new Map<string, PushRemoteFile>();
  const remoteDigests = new Map<string, string>();
  const nextFiles: Record<string, SyncFileSnapshot> = {};

  for (const file of options.remoteFiles) {
    if (remoteByPath.has(file.path)) {
      throw new Error(`Veryfront returned duplicate remote file path "${file.path}".`);
    }
    if (protectedDeletePaths.has(file.path)) {
      remoteByPath.set(file.path, file);
      continue;
    }
    const digest = await computeContentDigest(requiredContent(file));
    remoteByPath.set(file.path, file);
    remoteDigests.set(file.path, digest);
    nextFiles[file.path] = {
      digest,
      ...(file.version_id ? { versionId: file.version_id } : {}),
    };
  }

  const uploads: PlannedUpload[] = [];
  const deletes: PlannedDelete[] = [];
  const conflicts = new Set<string>();

  for (const local of options.localFiles) {
    const localDigest = await computeContentDigest(local.content);
    const remote = remoteByPath.get(local.path);
    const baseline = options.baselineFiles[local.path];

    if (options.force) {
      uploads.push({ path: local.path, content: local.content });
      nextFiles[local.path] = { digest: localDigest };
      continue;
    }

    if (remote && remoteDigests.get(local.path) === localDigest) {
      nextFiles[local.path] = {
        digest: localDigest,
        ...(remote.version_id ? { versionId: remote.version_id } : {}),
      };
      continue;
    }

    if (!remote) {
      if (!options.remoteFilesAreBaseline && baseline) {
        conflicts.add(local.path);
        continue;
      }
      uploads.push({ path: local.path, content: local.content, expectedAbsent: true });
      nextFiles[local.path] = { digest: localDigest };
      continue;
    }

    const remoteDigest = remoteDigests.get(local.path);
    if (
      !options.remoteFilesAreBaseline &&
      (!baseline || baseline.digest !== remoteDigest)
    ) {
      conflicts.add(local.path);
      continue;
    }

    uploads.push({
      path: local.path,
      content: local.content,
      expectedVersionId: requiredVersionId(remote),
    });
    nextFiles[local.path] = { digest: localDigest };
  }

  for (const path of options.deletePaths) {
    const remote = remoteByPath.get(path);
    if (!remote) {
      delete nextFiles[path];
      continue;
    }

    if (options.force) {
      deletes.push({ path });
      delete nextFiles[path];
      continue;
    }

    if (protectedDeletePaths.has(path)) {
      deletes.push({ path, expectedVersionId: requiredVersionId(remote) });
      delete nextFiles[path];
      continue;
    }

    const baseline = options.baselineFiles[path];
    const remoteDigest = remoteDigests.get(path);
    if (
      !options.remoteFilesAreBaseline &&
      (!baseline || baseline.digest !== remoteDigest)
    ) {
      conflicts.add(path);
      continue;
    }

    deletes.push({ path, expectedVersionId: requiredVersionId(remote) });
    delete nextFiles[path];
  }

  return {
    uploads,
    deletes,
    conflicts: [...conflicts].sort(compareCodeUnits),
    nextFiles,
  };
}
