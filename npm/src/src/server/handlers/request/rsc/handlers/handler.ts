import * as dntShim from "../../../../../../_dnt.shims.js";
import { buildClientManifest } from "../../../../../rendering/rsc/component-analyzer.js";
import { RSCRenderer } from "../../../../../rendering/rsc/server-renderer/index.js";
import type { ClientComponentMeta } from "../../../../../rendering/rsc/types.js";
import { HydratorHandler } from "./hydrator-handler.js";
import { ManifestHandler } from "./manifest-handler.js";
import { PageHandler } from "./page-handler.js";
import { RenderHandler } from "./render-handler.js";
import { StreamHandler } from "./stream-handler.js";

export class RSCDevServerHandler {
  private renderer: RSCRenderer | null = null;
  private clientManifest: Map<string, ClientComponentMeta> | null = null;

  private readonly manifestHandler: ManifestHandler;
  private readonly renderHandler: RenderHandler;
  private readonly streamHandler: StreamHandler;
  private readonly pageHandler: PageHandler;
  private readonly hydratorHandler: HydratorHandler;

  constructor(private projectDir: string) {
    this.manifestHandler = new ManifestHandler(projectDir);
    this.renderHandler = new RenderHandler(projectDir, () => this.renderer);
    this.streamHandler = new StreamHandler(this.renderHandler);
    this.pageHandler = new PageHandler();
    this.hydratorHandler = new HydratorHandler();
  }

  handleManifest(): Promise<dntShim.Response> {
    return this.manifestHandler.handle(this.clientManifest);
  }

  async handleRender(
    pathname: string,
    searchParams: URLSearchParams,
    request?: dntShim.Request,
  ): Promise<dntShim.Response> {
    await this.ensureRenderer();
    return this.renderHandler.handle(pathname, searchParams, request);
  }

  async handleStream(pathname: string, searchParams: URLSearchParams): Promise<dntShim.Response> {
    await this.ensureRenderer();
    return this.streamHandler.handle(pathname, searchParams);
  }

  handlePage(pathname: string, searchParams: URLSearchParams): dntShim.Response {
    return this.pageHandler.handle(pathname, searchParams);
  }

  handleHydratorScript(): Promise<dntShim.Response> {
    return this.hydratorHandler.handle();
  }

  private async ensureRenderer(): Promise<void> {
    if (this.renderer) return;

    this.clientManifest = await buildClientManifest(this.projectDir);
    this.renderer = new RSCRenderer({
      clientManifest: this.clientManifest,
      projectDir: this.projectDir,
      mode: "development",
    });
  }
}
