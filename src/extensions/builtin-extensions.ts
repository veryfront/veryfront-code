import type { ResolvedExtension } from "./types.ts";
import { register, tryResolve } from "./contracts.ts";
import type { LLMProvider, LLMProviderRegistry } from "./llm/index.ts";
import { createLLMProviderRegistry, LLMProviderRegistryName } from "./llm/index.ts";
import { OpenAIProvider } from "../../extensions/ext-llm-openai/src/index.ts";
import { AnthropicProvider } from "../../extensions/ext-llm-anthropic/src/index.ts";
import { GoogleProvider } from "../../extensions/ext-llm-google/src/index.ts";
import extEsbuild from "../../extensions/ext-esbuild/src/index.ts";
import extBabel from "../../extensions/ext-babel/src/index.ts";
import extMdx from "../../extensions/ext-mdx/src/index.ts";
import extTailwind from "../../extensions/ext-tailwind/src/index.ts";
import extNodeCompat from "../../extensions/ext-node-compat/src/index.ts";

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
    {
      source: "builtin",
      origin: "veryfront/ext-esbuild",
      extension: extEsbuild(),
    },
    {
      source: "builtin",
      origin: "veryfront/ext-babel",
      extension: extBabel(),
    },
    {
      source: "builtin",
      origin: "veryfront/ext-mdx",
      extension: extMdx(),
    },
    {
      source: "builtin",
      origin: "veryfront/ext-tailwind",
      extension: extTailwind(),
    },
    {
      source: "builtin",
      origin: "veryfront/ext-node-compat",
      extension: extNodeCompat(),
    },
    ...BUILTIN_LLM_PROVIDERS.map(createBuiltinLLMProviderExtension),
  ];
}
