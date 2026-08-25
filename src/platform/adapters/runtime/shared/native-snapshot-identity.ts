/** Native path semantics used by exact file-snapshot adapters. */
export type NativeSnapshotPlatform = "posix" | "windows";

/**
 * File identity must distinguish an opened handle from a pathname replacement.
 * Some filesystems report a zero inode/file-index when that guarantee is not
 * available. Exact snapshots fail closed instead of treating that value as an
 * identity shared by unrelated files.
 */
export function hasUsableNativeFileIdentity(
  stat: Readonly<{ dev: bigint; ino: bigint }>,
): boolean {
  // libuv maps Windows st_dev to the volume serial number and may report zero
  // when the volume query is unsupported. A positive device/volume identity is
  // required so equal file indices on different volumes cannot compare equal.
  return stat.dev > 0n && stat.ino > 0n;
}
