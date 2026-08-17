import { SERVER_ONLY_IN_CLIENT } from "#veryfront/errors";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import { loadDefaultCodeParser } from "#veryfront/extensions/parser/defaults.ts";
import { MISSING_EXTENSION_ERROR } from "#veryfront/extensions/errors.ts";
import type { CodeParser } from "#veryfront/extensions/parser/index.ts";
import {
  describeServerExternalBrowserViolation,
  getConfiguredServerExternalPackage,
} from "#veryfront/transforms/shared/server-only-packages.ts";

interface CommonJsBrowserImportContext {
  filePath: string;
  projectDir?: string;
  serverExternalPackages?: readonly string[];
}

let defaultCommonJsParser: Promise<CodeParser | undefined> | undefined;
let loadCommonJsParser = loadDefaultCodeParser;

type CommonJsCapableParser = CodeParser & {
  findStaticCommonJsImports: NonNullable<CodeParser["findStaticCommonJsImports"]>;
};

function assertCommonJsCapableParser(
  parser: CodeParser | undefined,
): asserts parser is CommonJsCapableParser {
  if (typeof parser?.findStaticCommonJsImports === "function") return;
  throw MISSING_EXTENSION_ERROR.create({
    message: 'Missing CodeParser capability "findStaticCommonJsImports"',
    detail:
      "A capable @veryfront/ext-parser-babel extension is required to verify CommonJS browser imports",
    context: { contract: "CodeParser", capability: "findStaticCommonJsImports" },
  });
}

/** @internal Test-only seams; this module is not a public package entry point. */
export const commonJsPolicyInternals = Object.freeze({
  assertCommonJsCapableParser,
  resetDefaultParserLoaderForTest() {
    defaultCommonJsParser = undefined;
    loadCommonJsParser = loadDefaultCodeParser;
  },
  setDefaultParserLoaderForTest(loader: typeof loadDefaultCodeParser) {
    defaultCommonJsParser = undefined;
    loadCommonJsParser = loader;
  },
});

async function getCommonJsParser(): Promise<CodeParser | undefined> {
  const active = tryResolve<CodeParser>("CodeParser");
  if (active?.findStaticCommonJsImports) return active;
  defaultCommonJsParser ??= loadCommonJsParser();
  const pending = defaultCommonJsParser;
  try {
    return await pending;
  } catch (error) {
    if (defaultCommonJsParser === pending) defaultCommonJsParser = undefined;
    throw error;
  }
}

export function throwConfiguredServerExternalBrowserViolation(
  specifier: string,
  packageName: string,
  context: Pick<CommonJsBrowserImportContext, "filePath" | "projectDir">,
): never {
  const violation = describeServerExternalBrowserViolation(
    specifier,
    context.filePath,
    context.projectDir,
  );
  throw SERVER_ONLY_IN_CLIENT.create({
    message: violation.message,
    detail: `Declared server external package reached a browser transform: ${packageName}`,
    instance: violation.sourceIdentity,
    context: { packageName },
  });
}

/** Enforce declared package boundaries for CommonJS syntax esbuild does not always resolve. */
export async function assertNoConfiguredCommonJsBrowserImports(
  code: string,
  context: CommonJsBrowserImportContext,
): Promise<void> {
  if (
    context.serverExternalPackages === undefined ||
    context.serverExternalPackages.length === 0
  ) {
    return;
  }

  const parser = await getCommonJsParser();
  assertCommonJsCapableParser(parser);

  const specifiers = await parser.findStaticCommonJsImports({
    code,
    filePath: context.filePath,
  });
  assertNoConfiguredCommonJsSpecifiers(specifiers, context);
}

function assertNoConfiguredCommonJsSpecifiers(
  specifiers: readonly string[],
  context: CommonJsBrowserImportContext,
): void {
  for (let index = 0; index < specifiers.length; index++) {
    const specifier = specifiers[index]!;
    const packageName = getConfiguredServerExternalPackage(
      specifier,
      context.serverExternalPackages,
    );
    if (packageName !== undefined) {
      throwConfiguredServerExternalBrowserViolation(specifier, packageName, context);
    }
  }
}
