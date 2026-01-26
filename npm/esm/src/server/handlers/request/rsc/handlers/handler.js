import { buildClientManifest } from "../../../../../rendering/rsc/component-analyzer.js";
import { RSCRenderer } from "../../../../../rendering/rsc/server-renderer/index.js";
import { HydratorHandler } from "./hydrator-handler.js";
import { ManifestHandler } from "./manifest-handler.js";
import { PageHandler } from "./page-handler.js";
import { RenderHandler } from "./render-handler.js";
import { StreamHandler } from "./stream-handler.js";
export class RSCDevServerHandler {
    projectDir;
    renderer = null;
    clientManifest = null;
    manifestHandler;
    renderHandler;
    streamHandler;
    pageHandler;
    hydratorHandler;
    constructor(projectDir) {
        this.projectDir = projectDir;
        this.manifestHandler = new ManifestHandler(projectDir);
        this.renderHandler = new RenderHandler(projectDir, () => this.renderer);
        this.streamHandler = new StreamHandler(this.renderHandler);
        this.pageHandler = new PageHandler();
        this.hydratorHandler = new HydratorHandler();
    }
    handleManifest() {
        return this.manifestHandler.handle(this.clientManifest);
    }
    async handleRender(pathname, searchParams, request) {
        await this.ensureRenderer();
        return this.renderHandler.handle(pathname, searchParams, request);
    }
    async handleStream(pathname, searchParams) {
        await this.ensureRenderer();
        return this.streamHandler.handle(pathname, searchParams);
    }
    handlePage(pathname, searchParams) {
        return this.pageHandler.handle(pathname, searchParams);
    }
    handleHydratorScript() {
        return this.hydratorHandler.handle();
    }
    async ensureRenderer() {
        if (this.renderer)
            return;
        this.clientManifest = await buildClientManifest(this.projectDir);
        this.renderer = new RSCRenderer({
            clientManifest: this.clientManifest,
            projectDir: this.projectDir,
            mode: "development",
        });
    }
}
