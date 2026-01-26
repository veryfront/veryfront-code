import * as dntShim from "../../../../../../_dnt.shims.js";
import type { RenderHandler } from "./render-handler.js";
export declare class StreamHandler {
    private renderHandler;
    constructor(renderHandler: RenderHandler);
    handle(pathname: string, searchParams: URLSearchParams): Promise<dntShim.Response>;
    private getFinalHtml;
    private createStream;
}
//# sourceMappingURL=stream-handler.d.ts.map