export interface ParsedBarePackageSpecifier {
  packageName: string;
  version: string | null;
  subpath: string | null;
}

const MAX_PACKAGE_SPECIFIER_LENGTH = 1024;
const MAX_PACKAGE_NAME_LENGTH = 214;
const MAX_PACKAGE_SUBPATH_LENGTH = 768;
const PACKAGE_PART_PATTERN = /^[A-Za-z0-9_](?:[A-Za-z0-9._~-]*[A-Za-z0-9_~])?$/;
const PACKAGE_VERSION_PATTERN = /^[A-Za-z0-9~^*<>=][A-Za-z0-9._+~^*<>=|-]{0,127}$/;
const PACKAGE_SUBPATH_SEGMENT_PATTERN = /^[A-Za-z0-9._~!$&'()+,;=@-]+$/;

function isValidPackageName(packageName: string): boolean {
  if (packageName.length === 0 || packageName.length > MAX_PACKAGE_NAME_LENGTH) return false;

  if (!packageName.startsWith("@")) return PACKAGE_PART_PATTERN.test(packageName);

  const parts = packageName.slice(1).split("/");
  return parts.length === 2 && parts.every((part) => PACKAGE_PART_PATTERN.test(part));
}

function isValidVersion(version: string | null): boolean {
  return version === null || PACKAGE_VERSION_PATTERN.test(version);
}

function isValidSubpath(subpath: string | null): boolean {
  if (subpath === null) return true;
  if (!subpath.startsWith("/") || subpath.length > MAX_PACKAGE_SUBPATH_LENGTH) return false;

  return subpath.slice(1).split("/").every((segment) =>
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    PACKAGE_SUBPATH_SEGMENT_PATTERN.test(segment)
  );
}

export function parseBarePackageSpecifier(
  specifier: string,
): ParsedBarePackageSpecifier | null {
  if (specifier.length === 0 || specifier.length > MAX_PACKAGE_SPECIFIER_LENGTH) return null;

  const scopedMatch = specifier.match(/^(@[^/]+\/[^/@]+)(?:@([^/]+))?(\/.*)?$/);
  if (scopedMatch?.[1]) {
    const parsed = {
      packageName: scopedMatch[1],
      version: scopedMatch[2] ?? null,
      subpath: scopedMatch[3] ?? null,
    };
    return isValidPackageName(parsed.packageName) &&
        isValidVersion(parsed.version) &&
        isValidSubpath(parsed.subpath)
      ? parsed
      : null;
  }

  const unscopedMatch = specifier.match(/^([^/@][^/@]*?)(?:@([^/]+))?(\/.*)?$/);
  if (unscopedMatch?.[1]) {
    const parsed = {
      packageName: unscopedMatch[1],
      version: unscopedMatch[2] ?? null,
      subpath: unscopedMatch[3] ?? null,
    };
    return isValidPackageName(parsed.packageName) &&
        isValidVersion(parsed.version) &&
        isValidSubpath(parsed.subpath)
      ? parsed
      : null;
  }

  return null;
}
