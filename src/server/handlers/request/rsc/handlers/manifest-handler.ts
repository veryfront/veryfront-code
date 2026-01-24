import { RSC_MANIFEST_CACHE_TTL_MS } from "#veryfront/utils";
import { buildClientManifest } from "#veryfront/rendering/rsc/component-analyzer.ts";
import type { ClientComponentMeta } from "#veryfront/rendering/rsc/types.ts";
import type { ManifestCacheEntry, ManifestData } from "./types.ts";

export class ManifestHandler {
  private cache: ManifestCacheEntry | null = null;

  constructor(private projectDir: string) {}

  async handle(clientManifest: Map<string, ClientComponentMeta> | null): Promise<Response> {
    if (this.isCacheValid()) {
      return this.createResponse(this.cache?.data as ManifestData);
    }

    const data = await this.buildManifest(clientManifest);
    this.cache = { data, timestamp: Date.now() };

    return this.createResponse(data);
  }

  private isCacheValid(): boolean {
    return this.cache !== null && Date.now() - this.cache.timestamp < RSC_MANIFEST_CACHE_TTL_MS;
  }

  private async buildManifest(
    clientManifest: Map<string, ClientComponentMeta> | null,
  ): Promise<ManifestData> {
    const manifest = clientManifest ?? (await buildClientManifest(this.projectDir));
    const components: Record<string, string> = {};

    for (const [id, meta] of manifest) {
      components[id] = meta.path;
    }

    return { components };
  }

  private createResponse(data: ManifestData): Response {
    return new Response(JSON.stringify(data), {
      headers: { "content-type": "application/json" },
    });
  }
}
