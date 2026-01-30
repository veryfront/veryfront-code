import type { RuntimeAdapter } from "../platform/adapters/base.js";
import type { DataContext, DataResult, PageWithData } from "./types.js";
export declare class ServerDataFetcher {
    private adapter?;
    constructor(adapter?: RuntimeAdapter | undefined);
    fetch(pageModule: PageWithData, context: DataContext): Promise<DataResult>;
    /**
     * Log errors unconditionally. Production errors should always be logged.
     * @see plans/architecture-audit/010-error-handling.md
     */
    private logError;
}
//# sourceMappingURL=server-data-fetcher.d.ts.map