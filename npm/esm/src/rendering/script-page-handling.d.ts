import type { ComponentProps, EntityInfo, RenderResult } from "../types/index.js";
import type { VeryfrontConfig } from "../config/index.js";
import type { RuntimeAdapter } from "../platform/adapters/base.js";
interface ScriptPageOptions {
    mode: string;
    config: VeryfrontConfig;
    projectDir: string;
    adapter: RuntimeAdapter;
    params?: Record<string, string | string[]>;
    props?: ComponentProps;
    nonce?: string;
}
export declare function handleScriptPage(pageInfo: EntityInfo, slug: string, options: ScriptPageOptions): Promise<RenderResult>;
export {};
//# sourceMappingURL=script-page-handling.d.ts.map