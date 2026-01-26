import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { DynamicRouter } from "./api-route-matcher.js";
export declare function discoverPagesRoutes(router: DynamicRouter, dir: string, prefix: string, adapter: RuntimeAdapter): Promise<void>;
export declare function discoverAppRoutes(router: DynamicRouter, dir: string, prefix: string, adapter: RuntimeAdapter): Promise<void>;
//# sourceMappingURL=route-discovery.d.ts.map