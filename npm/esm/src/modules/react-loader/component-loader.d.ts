import type * as React from "react";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { LoadComponentOptions } from "./types.js";
export declare function loadComponentFromSource(source: string, filePath: string, projectDir: string, adapter: RuntimeAdapter, options?: LoadComponentOptions): Promise<React.ComponentType<Record<string, unknown>>>;
//# sourceMappingURL=component-loader.d.ts.map