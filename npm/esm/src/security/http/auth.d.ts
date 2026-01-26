import * as dntShim from "../../../_dnt.shims.js";
import { BaseHandler } from "./base-handler.js";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../../types/index.js";
export declare class AuthHandler extends BaseHandler {
    metadata: HandlerMetadata;
    private basicUser;
    private basicPass;
    private basicRealm;
    private bearerToken;
    handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult>;
    private loadAuthConfig;
    private shouldUseBasic;
    private shouldUseBearer;
    private checkBasicAuth;
    private checkBearerAuth;
}
//# sourceMappingURL=auth.d.ts.map