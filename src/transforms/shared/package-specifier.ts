export interface ParsedBarePackageSpecifier {
  packageName: string;
  version: string | null;
  subpath: string | null;
}

const ReflectApply = Reflect.apply;
const RegExpExec = RegExp.prototype.exec;
const SCOPED_PACKAGE_SPECIFIER = /^(@[^/]+\/[^/@]+)(?:@([^/]+))?(\/.*)?$/;
const UNSCOPED_PACKAGE_SPECIFIER = /^([^/@][^/@]*?)(?:@([^/]+))?(\/.*)?$/;

function regExpExec(pattern: RegExp, value: string): RegExpExecArray | null {
  return ReflectApply(RegExpExec, pattern, [value]) as RegExpExecArray | null;
}

export function parseBarePackageSpecifier(
  specifier: string,
): ParsedBarePackageSpecifier | null {
  const scopedMatch = regExpExec(SCOPED_PACKAGE_SPECIFIER, specifier);
  if (scopedMatch?.[1]) {
    return {
      packageName: scopedMatch[1],
      version: scopedMatch[2] ?? null,
      subpath: scopedMatch[3] ?? null,
    };
  }

  const unscopedMatch = regExpExec(UNSCOPED_PACKAGE_SPECIFIER, specifier);
  if (unscopedMatch?.[1]) {
    return {
      packageName: unscopedMatch[1],
      version: unscopedMatch[2] ?? null,
      subpath: unscopedMatch[3] ?? null,
    };
  }

  return null;
}
