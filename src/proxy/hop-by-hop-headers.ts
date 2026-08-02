const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
] as const;

const HTTP_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;

/**
 * Copy end-to-end headers while removing both standard hop-by-hop fields and
 * extension fields named by the Connection header.
 */
export function createProxyEndToEndHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  const connection = headers.get("connection");
  if (connection) {
    let start = 0;
    for (let index = 0; index <= connection.length; index++) {
      if (index !== connection.length && connection.charCodeAt(index) !== 0x2c) continue;
      const name = connection.slice(start, index).trim().toLowerCase();
      if (HTTP_TOKEN_PATTERN.test(name)) headers.delete(name);
      start = index + 1;
    }
  }
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
  return headers;
}
