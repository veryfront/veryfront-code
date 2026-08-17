import { register, tryResolve } from "../contracts.ts";
import {
  importFirstPartyExtensionModule,
  isMissingFirstPartyExtensionModule,
} from "../first-party-import.ts";
import { assertRequiredMethods, getConstructibleModuleExport } from "../runtime-validation.ts";
import type { CodeParser } from "./code-parser.ts";

const DEFAULT_PARSER_SOURCE_DIRECTORY = "ext-parser-babel";
const DEFAULT_PARSER_EXTENSION_PACKAGE = "@veryfront/ext-parser-babel";

function isMissingDefaultParserExtension(error: unknown): boolean {
  return isMissingFirstPartyExtensionModule(error, [
    "extensions/ext-parser-babel/src/index",
    DEFAULT_PARSER_EXTENSION_PACKAGE,
  ]);
}

function createDefaultParser(extensionModule: unknown): CodeParser {
  const BabelCodeParser = getConstructibleModuleExport<CodeParser>(
    extensionModule,
    DEFAULT_PARSER_EXTENSION_PACKAGE,
    "BabelCodeParser",
  );
  const parser = new BabelCodeParser();
  assertRequiredMethods(
    parser,
    DEFAULT_PARSER_EXTENSION_PACKAGE,
    "BabelCodeParser",
    ["parse", "traverse", "generate", "injectJsxNodePositions"],
  );
  return parser;
}

function registerDefaultParserModule(extensionModule: unknown): void {
  if (tryResolve<CodeParser>("CodeParser") !== undefined) return;

  const parser = createDefaultParser(extensionModule);

  // The constructor is extension code and may register an explicit parser.
  // Preserve that binding instead of replacing it after construction.
  if (tryResolve<CodeParser>("CodeParser") === undefined) {
    register("CodeParser", parser);
  }
}

/** @internal Test-only seams; this module is not a public package entry point. */
export const defaultParserContractsInternals = Object.freeze({
  createDefaultParser,
  isMissingDefaultParserExtension,
  registerDefaultParserModule,
});

/** @internal Load a first-party parser instance without replacing an active contract. */
export async function loadDefaultCodeParser(): Promise<CodeParser | undefined> {
  let extensionModule: unknown;
  try {
    extensionModule = await importFirstPartyExtensionModule<unknown>(
      DEFAULT_PARSER_SOURCE_DIRECTORY,
      DEFAULT_PARSER_EXTENSION_PACKAGE,
    );
  } catch (error) {
    if (!isMissingDefaultParserExtension(error)) throw error;
    return undefined;
  }
  return createDefaultParser(extensionModule);
}

/**
 * Lazily register the first-party CodeParser implementation when it is
 * available from workspace source or an installed @veryfront/ext package.
 */
export async function ensureDefaultParserContracts(): Promise<void> {
  if (tryResolve("CodeParser") !== undefined) return;

  const parser = await loadDefaultCodeParser();
  if (parser !== undefined && tryResolve<CodeParser>("CodeParser") === undefined) {
    register("CodeParser", parser);
  }
}
