export interface ParsedBarePackageSpecifier {
  packageName: string;
  version: string | null;
  subpath: string | null;
}

export function parseBarePackageSpecifier(
  specifier: string,
): ParsedBarePackageSpecifier | null {
  const scopedMatch = specifier.match(/^(@[^/]+\/[^/@]+)(?:@([^/]+))?(\/.*)?$/);
  if (scopedMatch?.[1]) {
    return {
      packageName: scopedMatch[1],
      version: scopedMatch[2] ?? null,
      subpath: scopedMatch[3] ?? null,
    };
  }

  const unscopedMatch = specifier.match(/^([^/@][^/@]*?)(?:@([^/]+))?(\/.*)?$/);
  if (unscopedMatch?.[1]) {
    return {
      packageName: unscopedMatch[1],
      version: unscopedMatch[2] ?? null,
      subpath: unscopedMatch[3] ?? null,
    };
  }

  return null;
}
