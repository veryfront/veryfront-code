/**
 * Security headers handler (CSP, COOP, CORP, COEP) with nonce-based CSP
 */
import * as dntShim from "../../../../_dnt.shims.js";
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import type { SecurityConfig } from "./types.js";
/** Generate cryptographic nonce for CSP */
export declare function generateNonce(): string;
/** Build Content Security Policy header with nonce */
export declare function buildCSP(_isDev: boolean, nonce: string, cspUserHeader: string | null, config?: SecurityConfig | null, adapter?: RuntimeAdapter): string;
/** Get security header value from config or environment */
export declare function getSecurityHeader(headerName: string, defaultValue: string, config?: SecurityConfig | null, adapter?: RuntimeAdapter): string;
/** Apply security headers to Headers object with nonce */
export declare function applySecurityHeaders(headers: dntShim.Headers, isDev: boolean, nonce: string, cspUserHeader: string | null, config?: SecurityConfig | null, adapter?: RuntimeAdapter, isVeryfrontDomain?: boolean): void;
//# sourceMappingURL=security-handler.d.ts.map