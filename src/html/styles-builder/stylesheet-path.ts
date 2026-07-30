import { isAbsolute, resolve } from "#veryfront/compat/path/resolution.ts";
import {
  assertCanonicalProjectRelativePath,
  resolveCanonicalProjectRelativePath,
} from "#veryfront/utils/project-relative-path.ts";

export const DEFAULT_PROJECT_STYLESHEET_PATHS = Object.freeze(
  [
    "globals.css",
    "global.css",
    "styles/globals.css",
    "app/globals.css",
    "src/globals.css",
    "src/styles/globals.css",
  ] as const,
);

export function assertCanonicalStylesheetPath(value: unknown): string {
  return assertCanonicalProjectRelativePath(value, "Stylesheet path");
}

export function resolveProjectStylesheetPath(
  projectDir: string,
  stylesheetPath: unknown,
): string {
  return resolveCanonicalProjectRelativePath(
    projectDir,
    stylesheetPath,
    "Stylesheet path",
  );
}

function portableSourcePath(path: string): string | null {
  const portable = path.replaceAll("\\", "/");
  const segments = portable.split("/");
  const firstContentSegment = portable.startsWith("/") ? 1 : 0;
  if (
    segments.slice(firstContentSegment).some((segment) =>
      segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    return null;
  }
  return portable;
}

/**
 * Match a project-relative configured path against a source-provider file key.
 * Providers may return the exact logical key or an absolute project file path.
 */
export function sourceFileMatchesStylesheetPath(
  sourcePath: string,
  configuredPath: string,
  options: { allowRelativePrefix?: boolean; projectDir?: string } = {},
): boolean {
  const canonicalPath = assertCanonicalStylesheetPath(configuredPath);
  const portable = portableSourcePath(sourcePath);
  if (portable === null) return false;
  if (portable === canonicalPath) return true;

  if (options.projectDir !== undefined && isAbsolute(portable)) {
    return resolve(portable) ===
      resolveProjectStylesheetPath(options.projectDir, canonicalPath);
  }

  return (options.projectDir === undefined && isAbsolute(portable) ||
    options.allowRelativePrefix === true) &&
    portable.endsWith(`/${canonicalPath}`);
}
