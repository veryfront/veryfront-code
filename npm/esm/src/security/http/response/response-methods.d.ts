import * as dntShim from "../../../../_dnt.shims.js";
export interface ResponseMethodsContext {
    headers: dntShim.Headers;
    status: number;
}
export declare function json(this: ResponseMethodsContext, data: unknown, status?: number): dntShim.Response;
export declare function text(this: ResponseMethodsContext, body: string, status?: number): dntShim.Response;
export declare function html(this: ResponseMethodsContext, body: string, status?: number): dntShim.Response;
export declare function javascript(this: ResponseMethodsContext, code: string, status?: number): dntShim.Response;
export declare function withContentType(this: ResponseMethodsContext, contentType: string, body: dntShim.BodyInit | null, status?: number): dntShim.Response;
export declare function build(this: ResponseMethodsContext, body?: dntShim.BodyInit | null, status?: number): dntShim.Response;
export declare function notModified(this: ResponseMethodsContext, etag?: string): dntShim.Response;
//# sourceMappingURL=response-methods.d.ts.map