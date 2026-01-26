export interface ParsedDomain {
    slug: string | null;
    branch: string | null;
    environment: "preview" | "development" | "staging" | "production" | null;
    isVeryfrontDomain: boolean;
    isDraft: boolean;
    /** Whether this domain allows iframe embedding (veryfront, localhost, xip.io, zip.io) */
    allowIframeEmbed: boolean;
}
/**
 * Extract project slug and branch from domain/host header
 */
export declare function parseProjectDomain(host: string): ParsedDomain;
/**
 * Check if a domain is a valid veryfront domain (includes veryfront.me and lvh.me for local dev)
 */
export declare function isVeryfrontDomain(host: string): boolean;
/**
 * Get the effective project slug from request host or config
 */
export declare function getEffectiveProjectSlug(host: string, configuredSlug: string): {
    slug: string;
    fromHost: boolean;
};
//# sourceMappingURL=domain-parser.d.ts.map