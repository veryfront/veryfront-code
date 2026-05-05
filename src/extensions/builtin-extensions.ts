import type { ResolvedExtension } from "./types.ts";
import { register, tryResolve } from "./contracts.ts";
import type { AIProvider, AIProviderRegistry } from "./interfaces/index.ts";
import { AIProviderRegistryName } from "./interfaces/index.ts";
import { createAIProviderRegistry } from "./registries/ai-provider-registry.ts";
import { OpenAIProvider } from "../../extensions/ext-openai/src/index.ts";
import { AnthropicProvider } from "../../extensions/ext-anthropic/src/index.ts";
import { GoogleProvider } from "../../extensions/ext-google/src/index.ts";
import extEsbuild from "../../extensions/ext-esbuild/src/index.ts";
import extBabel from "../../extensions/ext-babel/src/index.ts";
import extMdx from "../../extensions/ext-mdx/src/index.ts";
import extTailwind from "../../extensions/ext-tailwind/src/index.ts";
import extNodeCompat from "../../extensions/ext-node-compat/src/index.ts";

type BuiltinAIProviderDefinition = {
  extensionName: string;
  origin: string;
  provider: () => AIProvider;
};

const BUILTIN_AI_PROVIDERS: BuiltinAIProviderDefinition[] = [
  {
    extensionName: "ext-openai",
    origin: "veryfront/ext-openai",
    provider: () => new OpenAIProvider(),
  },
  {
    extensionName: "ext-anthropic",
    origin: "veryfront/ext-anthropic",
    provider: () => new AnthropicProvider(),
  },
  {
    extensionName: "ext-google",
    origin: "veryfront/ext-google",
    provider: () => new GoogleProvider(),
  },
];

function getOrCreateAIProviderRegistry(): AIProviderRegistry {
  const existing = tryResolve<AIProviderRegistry>(AIProviderRegistryName);
  if (existing) return existing;

  const registry = createAIProviderRegistry();
  register(AIProviderRegistryName, registry);
  return registry;
}

function registerBuiltinAIProvider(
  registry: AIProviderRegistry,
  provider: AIProvider,
): boolean {
  if (registry.has(provider.id)) return false;
  registry.register(provider);
  return true;
}

export function ensureBuiltinAIProviders(): AIProviderRegistry {
  const registry = getOrCreateAIProviderRegistry();
  for (const definition of BUILTIN_AI_PROVIDERS) {
    registerBuiltinAIProvider(registry, definition.provider());
  }
  return registry;
}

function createBuiltinAIProviderExtension(
  definition: BuiltinAIProviderDefinition,
): ResolvedExtension {
  const provider = definition.provider();
  let didRegister = false;

  return {
    source: "builtin",
    origin: definition.origin,
    extension: {
      name: definition.extensionName,
      version: "0.1.0",
      capabilities: [{ type: "contract", name: `AIProvider:${provider.id}` }],
      setup(ctx) {
        const registry = ctx.require<AIProviderRegistry>(AIProviderRegistryName);
        didRegister = registerBuiltinAIProvider(registry, provider);
        if (didRegister) {
          ctx.logger.info(`[${definition.extensionName}] ${provider.id} provider registered`);
        }
      },
      teardown() {
        if (didRegister) {
          const registry = tryResolve<AIProviderRegistry>(AIProviderRegistryName);
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
    ...BUILTIN_AI_PROVIDERS.map(createBuiltinAIProviderExtension),
  ];
}
