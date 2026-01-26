import * as dntShim from "../../../../../../_dnt.shims.js";
import { RSC_MANIFEST_CACHE_TTL_MS } from "../../../../../utils/index.js";
import { buildClientManifest } from "../../../../../rendering/rsc/component-analyzer.js";
import type { ClientComponentMeta } from "../../../../../rendering/rsc/types.js";
import type { ManifestCacheEntry, ManifestData } from "./types.js";

export class ManifestHandler {
  private cache: ManifestCacheEntry | null = null;

  constructor(private projectDir: string) {}

  async handle(clientManifest: Map<string, ClientComponentMeta> | null): Promise<dntShim.Response> {
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

  private createResponse(data: ManifestData): dntShim.Response {
    return new dntShim.Response(JSON.stringify(data), {
      headers: { "content-type": "application/json" },
    });
  }
}
