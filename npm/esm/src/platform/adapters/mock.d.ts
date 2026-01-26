import type { RuntimeAdapter } from "./base.js";
export interface MockRuntimeAdapter extends RuntimeAdapter {
    fs: RuntimeAdapter["fs"] & {
        files: Map<string, string>;
        directories: Set<string>;
    };
}
export declare function createMockAdapter(): MockRuntimeAdapter;
//# sourceMappingURL=mock.d.ts.map