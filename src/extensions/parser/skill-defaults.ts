import { register, tryResolve } from "../contracts.ts";
import { importFirstPartyExtensionModule } from "../first-party-import.ts";
import {
  type SkillDocumentParserProvider,
  SkillDocumentParserProviderName,
  snapshotSkillDocumentParserProvider,
} from "./skill-document-parser.ts";

const DEFAULT_SKILL_PARSER_SOURCE_DIRECTORY = "ext-yaml";
const DEFAULT_SKILL_PARSER_EXTENSION_PACKAGE = "@veryfront/ext-yaml";
const DEFAULT_SKILL_PARSER_FACTORY_EXPORT = "createStdYamlSkillDocumentParserProvider";

interface SkillParserExtensionModule {
  readonly createStdYamlSkillDocumentParserProvider?: unknown;
}

let activation: Promise<void> | undefined;

function readProviderFactory(extensionModule: unknown): () => unknown {
  if (
    extensionModule === null ||
    (typeof extensionModule !== "object" && typeof extensionModule !== "function")
  ) {
    throw new TypeError(
      `Invalid ${DEFAULT_SKILL_PARSER_EXTENSION_PACKAGE} module: expected a module namespace`,
    );
  }

  let factory: unknown;
  try {
    factory = (extensionModule as SkillParserExtensionModule)
      .createStdYamlSkillDocumentParserProvider;
  } catch (cause) {
    throw new TypeError(
      `Invalid ${DEFAULT_SKILL_PARSER_EXTENSION_PACKAGE} module: could not read export "${DEFAULT_SKILL_PARSER_FACTORY_EXPORT}"`,
      { cause },
    );
  }
  if (typeof factory !== "function") {
    throw new TypeError(
      `Invalid ${DEFAULT_SKILL_PARSER_EXTENSION_PACKAGE} module: export "${DEFAULT_SKILL_PARSER_FACTORY_EXPORT}" must be callable`,
    );
  }
  return factory as () => unknown;
}

async function activateDefaultSkillDocumentParser(): Promise<void> {
  const extensionModule = await importFirstPartyExtensionModule<unknown>(
    DEFAULT_SKILL_PARSER_SOURCE_DIRECTORY,
    DEFAULT_SKILL_PARSER_EXTENSION_PACKAGE,
  );
  const provider = snapshotSkillDocumentParserProvider(
    readProviderFactory(extensionModule)(),
  );

  // Extension orchestration may have completed while the dynamic import was
  // pending. Preserve its generation-owned binding when present.
  if (tryResolve(SkillDocumentParserProviderName) === undefined) {
    register(SkillDocumentParserProviderName, provider);
  }
}

/**
 * Ensure the product distribution's first-party YAML extension owns the
 * default Skill parser contract without introducing its dependency into core.
 */
export async function ensureDefaultSkillDocumentParserContract(): Promise<void> {
  if (tryResolve<SkillDocumentParserProvider>(SkillDocumentParserProviderName) !== undefined) {
    return;
  }
  activation ??= activateDefaultSkillDocumentParser().finally(() => {
    activation = undefined;
  });
  await activation;
}
