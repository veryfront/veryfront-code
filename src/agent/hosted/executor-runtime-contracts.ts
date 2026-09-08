import { ensureBuiltinSchemaValidator } from "#veryfront/extensions/builtin-schema-validator.ts";
import { ensureDefaultBundlerContracts } from "#veryfront/extensions/bundler/defaults.ts";
import type { Bundler } from "#veryfront/extensions/bundler/bundler.ts";
import type { ModuleLexer } from "#veryfront/extensions/bundler/module-lexer.ts";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import {
  ensureDefaultSkillDocumentParserContract,
} from "#veryfront/extensions/parser/skill-defaults.ts";
import {
  type SkillDocumentParserProvider,
  SkillDocumentParserProviderName,
} from "#veryfront/extensions/parser/skill-document-parser.ts";
import type { SchemaValidator } from "#veryfront/extensions/schema/index.ts";

let initialization: Promise<void> | undefined;

function assertRuntimeContracts(): void {
  const schema = tryResolve<SchemaValidator>("SchemaValidator");
  const bundler = tryResolve<Bundler>("Bundler");
  const lexer = tryResolve<ModuleLexer>("ModuleLexer");
  const skillParser = tryResolve<SkillDocumentParserProvider>(SkillDocumentParserProviderName);
  if (
    !schema || typeof schema.string !== "function" || typeof schema.object !== "function" ||
    !bundler || typeof bundler.bundle !== "function" || typeof bundler.transform !== "function" ||
    !lexer || typeof lexer.parse !== "function" ||
    !skillParser || typeof skillParser.parseFrontmatter !== "function"
  ) throw new TypeError("Executor runtime contracts are unavailable");
}

/**
 * Install the fixed first-party contracts required before executor project imports.
 * Concurrent and repeated startup preserves any already-registered trusted generation.
 */
export async function initializeExecutorRuntimeContracts(): Promise<void> {
  try {
    assertRuntimeContracts();
    return;
  } catch {
    // Missing contracts are initialized below; malformed registered contracts
    // remain authoritative and fail the final validation instead of being replaced.
  }
  initialization ??= (async () => {
    ensureBuiltinSchemaValidator();
    await Promise.all([
      ensureDefaultSkillDocumentParserContract(),
      // Uses the fixed ext-bundler-esbuild first-party import and rechecks the
      // registry after asynchronous module loading before registering.
      ensureDefaultBundlerContracts(),
    ]);
    assertRuntimeContracts();
  })().finally(() => {
    initialization = undefined;
  });
  await initialization;
}
