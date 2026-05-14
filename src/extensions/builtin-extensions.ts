import type { ResolvedExtension } from "./types.ts";
import { register, tryResolve } from "./contracts.ts";
import type { LLMProvider, LLMProviderRegistry } from "./llm/index.ts";
import { createLLMProviderRegistry, LLMProviderRegistryName } from "./llm/index.ts";
import { OpenAIProvider } from "../../extensions/ext-llm-openai/src/index.ts";
import { AnthropicProvider } from "../../extensions/ext-llm-anthropic/src/index.ts";
import { GoogleProvider } from "../../extensions/ext-llm-google/src/index.ts";
import extJwt from "../../extensions/ext-auth-jwt/src/index.ts";
import extEsbuild from "../../extensions/ext-bundler-esbuild/src/index.ts";
import extBabel from "../../extensions/ext-parser-babel/src/index.ts";
import extMdx from "../../extensions/ext-content-mdx/src/index.ts";
import extTailwind from "../../extensions/ext-css-tailwind/src/index.ts";
import extDocumentKreuzberg from "../../extensions/ext-document-kreuzberg/src/index.ts";
import extDbSqlite from "../../extensions/ext-db-sqlite/src/index.ts";
import extSandboxShellTools from "../../extensions/ext-sandbox-shell-tools/src/index.ts";
import extZod from "../../extensions/ext-schema-zod/src/index.ts";
import { createZodAdapter } from "../../extensions/ext-schema-zod/src/adapter.ts";

type BuiltinLLMProviderDefinition = {
  extensionName: string;
  origin: string;
  provider: () => LLMProvider;
};

const BUILTIN_LLM_PROVIDERS: BuiltinLLMProviderDefinition[] = [
  {
    extensionName: "ext-llm-openai",
    origin: "veryfront/ext-llm-openai",
    provider: () => new OpenAIProvider(),
  },
  {
    extensionName: "ext-llm-anthropic",
    origin: "veryfront/ext-llm-anthropic",
    provider: () => new AnthropicProvider(),
  },
  {
    extensionName: "ext-llm-google",
    origin: "veryfront/ext-llm-google",
    provider: () => new GoogleProvider(),
  },
];

function getOrCreateLLMProviderRegistry(): LLMProviderRegistry {
  const existing = tryResolve<LLMProviderRegistry>(LLMProviderRegistryName);
  if (existing) return existing;

  const registry = createLLMProviderRegistry();
  register(LLMProviderRegistryName, registry);
  return registry;
}

function registerBuiltinLLMProvider(
  registry: LLMProviderRegistry,
  provider: LLMProvider,
): boolean {
  if (registry.has(provider.id)) return false;
  registry.register(provider);
  return true;
}

export function ensureBuiltinLLMProviders(): LLMProviderRegistry {
  const registry = getOrCreateLLMProviderRegistry();
  for (const definition of BUILTIN_LLM_PROVIDERS) {
    registerBuiltinLLMProvider(registry, definition.provider());
  }
  return registry;
}

export function ensureBuiltinSchemaValidator(): void {
  if (!tryResolve("SchemaValidator")) {
    register("SchemaValidator", createZodAdapter());
  }
}

function createBuiltinLLMProviderExtension(
  definition: BuiltinLLMProviderDefinition,
): ResolvedExtension {
  const provider = definition.provider();
  let didRegister = false;

  return {
    source: "builtin",
    origin: definition.origin,
    extension: {
      name: definition.extensionName,
      version: "0.1.0",
      capabilities: [{ type: "contract", name: `LLMProvider:${provider.id}` }],
      setup(ctx) {
        const registry = ctx.require<LLMProviderRegistry>(LLMProviderRegistryName);
        didRegister = registerBuiltinLLMProvider(registry, provider);
        if (didRegister) {
          ctx.logger.info(`[${definition.extensionName}] ${provider.id} provider registered`);
        }
      },
      teardown() {
        if (didRegister) {
          const registry = tryResolve<LLMProviderRegistry>(LLMProviderRegistryName);
          registry?.unregister(provider.id);
          didRegister = false;
        }
      },
    },
  };
}

export function createBuiltinExtensions(): ResolvedExtension[] {
  return [
    // ext-schema-zod registers SchemaValidator. Listed FIRST so any subsequent
    // builtin whose setup() builds schemas via defineSchema() finds the
    // contract resolved.
    {
      source: "builtin",
      origin: "veryfront/ext-schema-zod",
      extension: extZod(),
    },
    {
      source: "builtin",
      origin: "veryfront/ext-auth-jwt",
      extension: extJwt(),
    },
    {
      source: "builtin",
      origin: "veryfront/ext-bundler-esbuild",
      extension: extEsbuild(),
    },
    {
      source: "builtin",
      origin: "veryfront/ext-parser-babel",
      extension: extBabel(),
    },
    {
      source: "builtin",
      origin: "veryfront/ext-content-mdx",
      extension: extMdx(),
    },
    {
      source: "builtin",
      origin: "veryfront/ext-css-tailwind",
      extension: extTailwind(),
    },
    {
      source: "builtin",
      origin: "veryfront/ext-document-kreuzberg",
      extension: extDocumentKreuzberg(),
    },
    {
      source: "builtin",
      origin: "veryfront/ext-db-sqlite",
      extension: extDbSqlite(),
    },
    {
      source: "builtin",
      origin: "veryfront/ext-sandbox-shell-tools",
      extension: extSandboxShellTools(),
    },
    ...BUILTIN_LLM_PROVIDERS.map(createBuiltinLLMProviderExtension),
  ];
}
