/**
 * Proxy environment utilities.
 */
declare const VALID_PROXY_ENVIRONMENTS: readonly ["preview", "production"];
export type ProxyEnvironment = (typeof VALID_PROXY_ENVIRONMENTS)[number];
/** Validate and parse proxy environment header */
export declare function parseProxyEnvironment(value: string | null): ProxyEnvironment | undefined;
export {};
//# sourceMappingURL=proxy-environment.d.ts.map