import { fromFileUrl, isAbsolute } from "#veryfront/compat/path";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { isWithinDirectory } from "#veryfront/utils/path-utils.ts";

type ReadFileAdapter = {
  fs?: { readFile?: (path: string) => Promise<string> };
};

function getAdapterReadFile(adapter: unknown): ((path: string) => Promise<string>) | undefined {
  const candidate = (adapter as ReadFileAdapter | null)?.fs?.readFile;
  if (typeof candidate !== "function") return undefined;
  return (path: string) => candidate.call((adapter as ReadFileAdapter).fs, path);
}

function fromFileUrlIfNeeded(path: string): string {
  return path.startsWith("file://") ? fromFileUrl(path) : path;
}

/**
 * Create the dependency reader used by the transform pipeline.
 *
 * Absolute paths outside `projectDir` belong to the local framework/runtime,
 * so they must bypass project adapters that may proxy reads to a remote source.
 * Paths inside the project retain adapter semantics.
 *
 * @internal
 */
export function createPipelineReadFile(
  adapter: unknown,
  projectDir: string,
): (path: string) => Promise<string> {
  const adapterRead = getAdapterReadFile(adapter);
  const localFileSystem = createFileSystem();
  const projectPath = fromFileUrlIfNeeded(projectDir);

  return (path: string): Promise<string> => {
    const fileSystemPath = fromFileUrlIfNeeded(path);
    const outsideProject = isAbsolute(fileSystemPath) &&
      projectPath.length > 0 &&
      !isWithinDirectory(projectPath, fileSystemPath);

    if (outsideProject || !adapterRead) {
      return localFileSystem.readTextFile(fileSystemPath);
    }
    return adapterRead(fileSystemPath);
  };
}
