import * as dntShim from "../../../../_dnt.shims.js";
export declare const HttpStatus: {
    readonly OK: 200;
    readonly CREATED: 201;
    readonly NO_CONTENT: 204;
    readonly MOVED_PERMANENTLY: 301;
    readonly FOUND: 302;
    readonly NOT_MODIFIED: 304;
    readonly BAD_REQUEST: 400;
    readonly UNAUTHORIZED: 401;
    readonly FORBIDDEN: 403;
    readonly NOT_FOUND: 404;
    readonly METHOD_NOT_ALLOWED: 405;
    readonly CONFLICT: 409;
    readonly UNPROCESSABLE_ENTITY: 422;
    readonly TOO_MANY_REQUESTS: 429;
    readonly INTERNAL_SERVER_ERROR: 500;
    readonly NOT_IMPLEMENTED: 501;
    readonly BAD_GATEWAY: 502;
    readonly SERVICE_UNAVAILABLE: 503;
    readonly GATEWAY_TIMEOUT: 504;
};
export type HttpStatusCode = (typeof HttpStatus)[keyof typeof HttpStatus];
interface ResponseOptions extends dntShim.ResponseInit {
    headers?: dntShim.HeadersInit;
    correlationId?: string;
}
export declare function errorResponse(status: HttpStatusCode, message?: string, options?: ResponseOptions): dntShim.Response;
export declare function jsonResponse<T>(data: T, status?: HttpStatusCode, options?: ResponseOptions): dntShim.Response;
export declare function redirectResponse(url: string, permanent?: boolean, options?: ResponseOptions): dntShim.Response;
export declare function notFound(message?: string, options?: ResponseOptions): dntShim.Response;
export declare function badRequest(message?: string, options?: ResponseOptions): dntShim.Response;
export declare function unauthorized(message?: string, options?: ResponseOptions): dntShim.Response;
export declare function forbidden(message?: string, options?: ResponseOptions): dntShim.Response;
export declare function internalServerError(message?: string, options?: ResponseOptions): dntShim.Response;
export declare function badGateway(message?: string, options?: ResponseOptions): dntShim.Response;
export declare function serviceUnavailable(message?: string, options?: ResponseOptions): dntShim.Response;
export declare function methodNotAllowed(allowed: string[], options?: ResponseOptions): dntShim.Response;
export declare function ok<T>(data?: T, options?: ResponseOptions): dntShim.Response;
export declare function created<T>(data?: T, location?: string, options?: ResponseOptions): dntShim.Response;
export declare function noContent(options?: ResponseOptions): dntShim.Response;
export declare function jsonErrorResponse(status: HttpStatusCode, error: string, options?: ResponseOptions): dntShim.Response;
export {};
//# sourceMappingURL=responses.d.ts.map