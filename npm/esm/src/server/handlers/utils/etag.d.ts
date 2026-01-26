import * as dntShim from "../../../../_dnt.shims.js";
export declare function computeEtag(content: string | Uint8Array, weak?: boolean): string;
export declare function computeStrongEtag(content: string | Uint8Array): string;
export declare function hasMatchingEtag(req: dntShim.Request, etag: string): boolean;
export declare function parseIfNoneMatch(header: string | null): string[];
export declare function matchesAnyEtag(etag: string, ifNoneMatch: string | null): boolean;
//# sourceMappingURL=etag.d.ts.map