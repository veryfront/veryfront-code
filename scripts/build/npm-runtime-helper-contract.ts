import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { init, parse } from "es-module-lexer";

function isWithinDirectory(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath));
}

async function* walkJavaScriptFiles(directory: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(directory)) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory) {
      yield* walkJavaScriptFiles(path);
    } else if (entry.isFile && /\.[cm]?js$/.test(entry.name)) {
      yield path;
    }
  }
}

/** Code-unit ordering keeps output byte-stable across locales. */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export async function assertNpmRuntimeHelperContract(
  esmRoot: string,
  expectedHelpers: readonly string[],
): Promise<void> {
  await init;

  const packageRoot = resolve(esmRoot);
  const sourceRoot = resolve(packageRoot, "src");
  const expected = new Set(expectedHelpers);
  const importedHelpers = new Set<string>();
  const unsupportedRootImports: string[] = [];
  const packageEscapes: string[] = [];
  const missing: string[] = [];

  const classifyImport = (
    specifier: string | undefined,
    sourcePath: string,
  ): { targetPath: string; packageRelativeTarget: string } | undefined => {
    if (!specifier?.startsWith("./") && !specifier?.startsWith("../")) {
      return;
    }

    const pathSpecifier = specifier.replace(/[?#].*$/s, "");
    const targetPath = resolve(dirname(sourcePath), pathSpecifier);
    if (isWithinDirectory(sourceRoot, targetPath)) return;

    const sourceRelativePath = relative(sourceRoot, sourcePath).split(sep)
      .join("/");
    if (!isWithinDirectory(packageRoot, targetPath)) {
      packageEscapes.push(`${sourceRelativePath}: ${specifier}`);
      return;
    }

    if (dirname(targetPath) !== packageRoot) return;

    const packageRelativeTarget = relative(packageRoot, targetPath).split(sep)
      .join("/");
    if (!expected.has(packageRelativeTarget)) {
      unsupportedRootImports.push(
        `${sourceRelativePath}: ${specifier} -> ${packageRelativeTarget}`,
      );
      return;
    }

    importedHelpers.add(packageRelativeTarget);
    return { targetPath, packageRelativeTarget };
  };

  const recordHelperStatFailure = (
    error: unknown,
    packageRelativeTarget: string,
  ): void => {
    if (error instanceof Deno.errors.NotFound) {
      missing.push(packageRelativeTarget);
    } else throw error;
  };

  for await (const sourcePath of walkJavaScriptFiles(sourceRoot)) {
    const source = await Deno.readTextFile(sourcePath);
    const [imports] = parse(source);

    for (const entry of imports) {
      const target = classifyImport(entry.n, sourcePath);
      if (target === undefined) continue;
      const { targetPath, packageRelativeTarget } = target;
      try {
        const stat = await Deno.stat(targetPath);
        if (!stat.isFile) missing.push(packageRelativeTarget);
      } catch (error) {
        recordHelperStatFailure(error, packageRelativeTarget);
      }
    }
  }

  const stale = expectedHelpers.filter((helper) =>
    !importedHelpers.has(helper)
  );
  if (
    unsupportedRootImports.length === 0 && packageEscapes.length === 0 &&
    missing.length === 0 && stale.length === 0
  ) return;

  const problems = [
    ...unsupportedRootImports.map((entry) =>
      `Unsupported package-root import: ${entry}`
    ),
    ...packageEscapes.map((entry) => `Import escapes ESM package: ${entry}`),
    ...[...new Set(missing)]
      .sort(compareCodeUnits)
      .map((helper) => `Missing imported helper: ${helper}`),
    ...stale.map((helper) =>
      `Expected helper is no longer imported: ${helper}`
    ),
  ];
  throw new Error(
    `Generated npm runtime helper contract failed:\n${problems.join("\n")}`,
  );
}
