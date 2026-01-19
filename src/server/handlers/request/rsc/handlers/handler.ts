import { buildClientManifest } from "#veryfront/rendering/rsc/component-analyzer.ts";
import { RSCRenderer } from "#veryfront/rendering/rsc/server-renderer/index.ts";
import type { ClientComponentMeta } from "#veryfront/rendering/rsc/types.ts";
import { HydratorHandler } from "./hydrator-handler.ts";
import { ManifestHandler } from "./manifest-handler.ts";
import { PageHandler } from "./page-handler.ts";
import { RenderHandler } from "./render-handler.ts";
import { StreamHandler } from "./stream-handler.ts";

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

  async handleManifest(): Promise<Response> {
    return await this.manifestHandler.handle(this.clientManifest);
  }

  async handleRender(
    pathname: string,
    searchParams: URLSearchParams,
    request?: Request,
  ): Promise<Response> {
    await this.ensureRenderer();
    return this.renderHandler.handle(pathname, searchParams, request);
  }

  async handleStream(pathname: string, searchParams: URLSearchParams): Promise<Response> {
    await this.ensureRenderer();
    return this.streamHandler.handle(pathname, searchParams);
  }

  handlePage(pathname: string, searchParams: URLSearchParams): Response {
    return this.pageHandler.handle(pathname, searchParams);
  }

  async handleHydratorScript(): Promise<Response> {
    return await this.hydratorHandler.handle();
  }

  private async ensureRenderer(): Promise<void> {
    if (!this.renderer) {
      this.clientManifest = await buildClientManifest(this.projectDir);
      this.renderer = new RSCRenderer({
        clientManifest: this.clientManifest,
        projectDir: this.projectDir,
        mode: "development",
      });
    }
  }
}
