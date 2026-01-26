export const LOCALHOST = {
    IPV4: "127.0.0.1",
    IPV6: "::1",
    HOSTNAME: "localhost",
};
export const HTTP_DEFAULTS = {
    PORT: 3000,
    HOST: "localhost",
    PROD_HOST: "0.0.0.0",
};
export const REDIS_DEFAULTS = {
    URL: "redis://127.0.0.1:6379",
    PORT: 6379,
    HOST: "127.0.0.1",
};
export const DEV_LOCALHOST_ORIGINS = [
    "http://localhost",
    "http://127.0.0.1",
    "https://localhost",
    "https://127.0.0.1",
];
export const DEV_LOCALHOST_CSP = {
    WS: "ws://localhost:* wss://localhost:*",
    HTTP: "http://localhost",
};
export const LOCALHOST_URLS = {
    HTTP: "http://localhost",
    HTTPS: "https://localhost",
    HTTP_IPV4: "http://127.0.0.1",
    HTTPS_IPV4: "https://127.0.0.1",
};
function buildUrl(host, port, protocol = "http") {
    return `${protocol}://${host}:${port}`;
}
export function buildLocalhostUrl(port, protocol = "http") {
    return buildUrl(LOCALHOST.HOSTNAME, port, protocol);
}
export function buildIpv4Url(port, protocol = "http") {
    return buildUrl(LOCALHOST.IPV4, port, protocol);
}
