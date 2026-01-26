import type * as React from "react";
import type { RSCPayload, RSCRendererOptions } from "../types.js";
export declare class RSCRenderer {
    private clientManifest;
    private mode;
    private clientRefs;
    constructor(options: RSCRendererOptions);
    renderToPayload(Component: React.ComponentType<any> | React.ReactElement, props?: Record<string, unknown>): Promise<RSCPayload>;
}
//# sourceMappingURL=rsc-renderer.d.ts.map