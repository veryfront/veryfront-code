export interface CORSConfig {
    origin?: string | string[] | ((origin: string) => boolean | string);
    credentials?: boolean;
    allowedHeaders?: string[];
    exposedHeaders?: string[];
    methods?: string[];
    maxAge?: number;
}
export type CSPDirectives = Partial<Record<string, string | string[]>>;
export interface BasicAuthConfig {
    username: string;
    password: string;
    realm?: string;
}
export interface BearerAuthConfig {
    token: string;
}
export interface AuthConfig {
    basic?: BasicAuthConfig;
    bearer?: BearerAuthConfig;
}
export interface SecurityConfig {
    auth?: AuthConfig;
    cors?: boolean | CORSConfig;
    csp?: CSPDirectives;
    coop?: "same-origin" | "same-origin-allow-popups" | "unsafe-none";
    corp?: "same-origin" | "same-site" | "cross-origin";
    coep?: "require-corp" | "unsafe-none";
    remoteHosts?: string[];
    headers?: Record<string, string>;
    [key: string]: unknown;
}
//# sourceMappingURL=types.d.ts.map