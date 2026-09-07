import { basename, dirname, fromFileUrl, join, relative, resolve } from "#veryfront/compat/path";
import {
  FRAMEWORK_EMBEDDED_SRC_DIR,
  FRAMEWORK_ROOT,
  FRAMEWORK_SRC_DIR,
} from "#veryfront/platform/compat/framework-source-resolver.ts";
import { PUBLISHED_RUNTIME_HELPERS } from "#veryfront/platform/compat/published-runtime-helpers.ts";
import { getDenoRuntime, isDenoCompiled } from "#veryfront/platform/compat/runtime.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import {
  captureBoundedTextReader,
  type CapturedSnapshotTextReader,
  captureSnapshotTextReader,
} from "#veryfront/platform/adapters/bounded-text-reader.ts";
import { isWithinDirectory } from "#veryfront/utils/path-utils.ts";
import { getFrameworkRoot } from "#veryfront/platform/compat/vfs-paths.ts";
import { splitSpecifierSuffix } from "#veryfront/transforms/shared/specifier-suffix.ts";

const sourceRoots = [FRAMEWORK_SRC_DIR, FRAMEWORK_EMBEDDED_SRC_DIR];

/** Recognize the executable's immutable VFS namespace, not self-extracted/native roots. */
export function isCompiledFrameworkImage(mainModule: string, frameworkRoot: string): boolean {
  try {
    const root = getFrameworkRoot(fromFileUrl(mainModule));
    return root !== "" && resolve(root) === resolve(frameworkRoot) &&
      basename(root).startsWith("deno-compile-");
  } catch {
    return false;
  }
}

/** A package-owned helper, never a project-relative lookup. */
export function publishedRuntimeHelperPath(key: string): string | undefined {
  return PUBLISHED_RUNTIME_HELPERS.some((helper) => helper === key)
    ? join(FRAMEWORK_ROOT, key)
    : undefined;
}

/** Preserve the physical framework package boundary when emitting logical references. */
export function resolveCapturedFrameworkReference(
  specifier: string,
  from: string,
): string | undefined {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
  const { path, suffix } = splitSpecifierSuffix(specifier);
  const target = resolve(dirname(from), path);
  for (const helper of PUBLISHED_RUNTIME_HELPERS) {
    if (target === publishedRuntimeHelperPath(helper)) {
      return `/_vf_modules/_veryfront/${helper}${suffix}`;
    }
  }
  const root = sourceRoots.find((candidate) => isWithinDirectory(candidate, target));
  if (!root) throw new TypeError("Framework import escapes its source package");
  return `/_vf_modules/_veryfront/${
    relative(root, target).replaceAll("\\", "/").replace(/\.src$/, "")
  }${suffix}`;
}

/** Bounded image reads for compiled framework files, stable snapshots for native files. */
export function captureFrameworkReader(): CapturedSnapshotTextReader {
  const fs = createFileSystem();
  const bounded = captureBoundedTextReader(fs);
  const deno = isDenoCompiled ? getDenoRuntime() : undefined;
  const immutableImage = deno !== undefined &&
    isCompiledFrameworkImage(deno.mainModule, FRAMEWORK_ROOT);
  let native: CapturedSnapshotTextReader | undefined;
  return {
    async readUtf8(path, root, maximumBytes, label) {
      if (!isWithinDirectory(root, path)) {
        throw new TypeError("Framework source escapes its read root");
      }
      const imageRoot = sourceRoots.includes(root) ||
        (root === FRAMEWORK_ROOT &&
          PUBLISHED_RUNTIME_HELPERS.some((helper) => path === publishedRuntimeHelperPath(helper)));
      if (immutableImage && imageRoot) {
        // The main module and this package identify the same Deno VFS mount.
        // Deno routes this namespace to its read-only image, not native files.
        return await bounded.readUtf8(path, maximumBytes, label);
      }
      native ??= captureSnapshotTextReader(fs);
      return await native.readUtf8(path, root, maximumBytes, label);
    },
  };
}
