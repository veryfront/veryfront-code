/**
 * Veryfront Renderer Development Config
 *
 * For local development, just run: deno task start
 * Configuration via environment variables in .env
 */

export default {
  // Filesystem: fetch from Veryfront API (cloud)
  fs: {
    type: "veryfront-api" as const,
    veryfront: {
      baseUrl: Deno.env.get("VERYFRONT_API_BASE_URL") || "http://api.lvh.me:4000",
      proxyMode: true, // Always proxy mode - token comes from proxy headers
      cache: { enabled: true, ttl: 60000 },
    },
  },

  // Dev server
  dev: {
    port: 3001,
    host: "lvh.me",
    hmr: true,
  },
};
