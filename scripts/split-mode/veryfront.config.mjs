/**
 * Production-like config for local split mode debugging.
 * Matches the Kubernetes ConfigMap in veryfront-cloud-renderer.
 */
export default {
  fs: {
    type: "veryfront-api",
    veryfront: {
      baseUrl: process.env.VERYFRONT_API_BASE_URL || "https://api.veryfront.com",
      proxyMode: true,
      cache: { enabled: true, ttl: 60000 },
      retry: { maxRetries: 3, initialDelay: 500, maxDelay: 5000 },
    },
  },
};
