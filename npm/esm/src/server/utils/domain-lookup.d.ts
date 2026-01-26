export interface DomainLookupResult {
    project_id: string;
    project_slug: string;
    project_name: string;
    environment: {
        id: string;
        name: string;
    } | null;
    release_id: string | null;
}
export interface DomainLookupConfig {
    apiBaseUrl: string;
    apiToken: string;
}
export declare function lookupProjectByDomain(domain: string, config: DomainLookupConfig): Promise<DomainLookupResult | null>;
export declare function clearDomainCache(): void;
export declare function getDomainCacheStats(): {
    size: number;
    maxSize: number;
};
export declare function getEnvironmentType(result: DomainLookupResult | null): "preview" | "production" | undefined;
//# sourceMappingURL=domain-lookup.d.ts.map