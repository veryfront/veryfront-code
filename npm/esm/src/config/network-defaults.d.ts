export declare const LOCALHOST: {
    readonly IPV4: "127.0.0.1";
    readonly IPV6: "::1";
    readonly HOSTNAME: "localhost";
};
export declare const HTTP_DEFAULTS: {
    readonly PORT: 3000;
    readonly HOST: "localhost";
    readonly PROD_HOST: "0.0.0.0";
};
export declare const REDIS_DEFAULTS: {
    readonly URL: "redis://127.0.0.1:6379";
    readonly PORT: 6379;
    readonly HOST: "127.0.0.1";
};
export declare const DEV_LOCALHOST_ORIGINS: readonly ["http://localhost", "http://127.0.0.1", "https://localhost", "https://127.0.0.1"];
export declare const DEV_LOCALHOST_CSP: {
    readonly WS: "ws://localhost:* wss://localhost:*";
    readonly HTTP: "http://localhost";
};
export declare const LOCALHOST_URLS: {
    readonly HTTP: "http://localhost";
    readonly HTTPS: "https://localhost";
    readonly HTTP_IPV4: "http://127.0.0.1";
    readonly HTTPS_IPV4: "https://127.0.0.1";
};
export declare function buildLocalhostUrl(port: number, protocol?: "http" | "https"): string;
export declare function buildIpv4Url(port: number, protocol?: "http" | "https"): string;
//# sourceMappingURL=network-defaults.d.ts.map