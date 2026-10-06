import { decodeCacheKeySegment } from "./segment-codec.ts";

/** Decode ownership of versioned file/stat/directory keys before their path. */
export function decodeFileOperationSource(parts: string[]): {
  projectSlug: string;
  sourceType: "branch" | "release" | "env";
  qualifier: string;
  releaseId?: string;
} | null {
  if (!isVersionedFileOperationSource(parts)) return null;
  const projectSlug = decodeCacheKeySegment(parts[2] ?? "");
  const qualifier = decodeCacheKeySegment(parts[3] ?? "");
  if (projectSlug === null || qualifier === null) return null;
  if (parts[1] === "env-v2") {
    const releaseId = decodeCacheKeySegment(parts[4] ?? "");
    if (releaseId === null) return null;
    return { projectSlug, sourceType: "env", qualifier, releaseId };
  }
  return { projectSlug, sourceType: parts[1] === "branch-v2" ? "branch" : "release", qualifier };
}

export function isVersionedFileOperationSource(parts: string[]): boolean {
  return (parts[0] === "file" || parts[0] === "stat" || parts[0] === "dir") &&
    (parts[1] === "branch-v2" || parts[1] === "release-v2" || parts[1] === "env-v2");
}
