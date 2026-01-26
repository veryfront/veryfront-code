import * as dntShim from "../../../../../../_dnt.shims.js";
import { RSC_MANIFEST_CACHE_TTL_MS } from "../../../../../utils/index.js";
import { buildClientManifest } from "../../../../../rendering/rsc/component-analyzer.js";
export class ManifestHandler {
    projectDir;
    cache = null;
    constructor(projectDir) {
        this.projectDir = projectDir;
    }
    async handle(clientManifest) {
        if (this.isCacheValid()) {
            return this.createResponse(this.cache?.data);
        }
        const data = await this.buildManifest(clientManifest);
        this.cache = { data, timestamp: Date.now() };
        return this.createResponse(data);
    }
    isCacheValid() {
        return this.cache !== null && Date.now() - this.cache.timestamp < RSC_MANIFEST_CACHE_TTL_MS;
    }
    async buildManifest(clientManifest) {
        const manifest = clientManifest ?? (await buildClientManifest(this.projectDir));
        const components = {};
        for (const [id, meta] of manifest) {
            components[id] = meta.path;
        }
        return { components };
    }
    createResponse(data) {
        return new dntShim.Response(JSON.stringify(data), {
            headers: { "content-type": "application/json" },
        });
    }
}
