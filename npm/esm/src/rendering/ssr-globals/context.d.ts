/**
 * SSR Context State
 * @module rendering/ssr-globals/context
 */
import * as dntShim from "../../../_dnt.shims.js";
export declare const originalFetch: typeof dntShim.fetch;
export declare function isSSRGlobalsActive(): boolean;
export declare function markSSRGlobalsInitialized(): void;
export declare function getSSRServerPort(): number | null;
export declare function setSSRServerPort(port: number): void;
export declare function getSSRProjectDomain(): string | null;
export declare function setSSRProjectDomain(domain: string | null): void;
export declare function isSSRClientOnlyFetching(): boolean;
export declare function enableSSRClientOnlyFetching(): void;
export declare function disableSSRClientOnlyFetching(): void;
export declare function resetSSRGlobalsState(): void;
//# sourceMappingURL=context.d.ts.map