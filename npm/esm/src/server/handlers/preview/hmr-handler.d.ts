import * as dntShim from "../../../../_dnt.shims.js";
import { BaseHandler } from "../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../types.js";
export declare class HMRHandler extends BaseHandler {
    private static clientsMap;
    private static clients;
    private static rateLimiter;
    private static reloadUnsubscribe;
    private static pingInterval;
    private static initialized;
    private static metrics;
    metadata: HandlerMetadata;
    private static initialize;
    private static sendPingToAllClients;
    private static requiresFullReload;
    private static broadcastUpdate;
    private static broadcastMessage;
    handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult>;
    static getClientCount(): number;
    static getMetrics(): {
        clients: number;
        broadcastsSent: number;
        messagesForwarded: number;
        lastBroadcastTime: number;
    };
    static shutdown(): void;
}
//# sourceMappingURL=hmr-handler.d.ts.map