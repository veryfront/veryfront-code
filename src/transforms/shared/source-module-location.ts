import { computeHash } from "#veryfront/utils/hash-utils.ts";
import type { LocalReactPeerSnapshot } from "#veryfront/platform/compat/react-paths.ts";

export function getSourceModuleRuntimeUrl(moduleUrl: string | URL = import.meta.url): string {
  return new URL("./source-module-runtime.mjs", moduleUrl).href;
}

export async function buildSourceModuleMetaBinding(
  source: string,
  sourceUrl: string,
  runtimeUrl: string,
  peers?: LocalReactPeerSnapshot,
): Promise<{ name: string; banner: string }> {
  const runtime = await import(runtimeUrl);
  await runtime.prepareSourceModuleMeta(sourceUrl, peers);
  const name = `__vf_source_meta_${await computeHash(`${source}\0${sourceUrl}`)}`;
  return {
    name,
    banner:
      `import { createSourceModuleMeta as ${name}_create } from ${JSON.stringify(runtimeUrl)};\n` +
      `const ${name} = ${name}_create(import.meta, ${JSON.stringify(sourceUrl)}, ${
        JSON.stringify({ paths: peers?.paths, roots: peers?.roots })
      });`,
  };
}
