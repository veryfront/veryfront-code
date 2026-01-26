export interface RequestLimits {
    maxBodySize?: number;
    maxUrlLength?: number;
    maxHeaderSize?: number;
    maxFileSize?: number;
}
export declare const DEFAULT_LIMITS: Required<RequestLimits>;
export interface ParseJsonOptions {
    limits?: RequestLimits;
    sanitize?: boolean;
}
export interface ParseFormOptions {
    limits?: RequestLimits;
}
export interface ValidatedData<TBody = unknown, TQuery = unknown> {
    body?: TBody;
    query?: TQuery;
}
//# sourceMappingURL=types.d.ts.map