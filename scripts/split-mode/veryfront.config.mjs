/**
 * Production-like config for local split mode debugging.
 * Matches the Kubernetes ConfigMap in veryfront-cloud-renderer.
 */
const getEnv = (key, defaultValue) => {
  // Support both Deno and Node environments
  if (typeof Deno !== "undefined") {
    return Deno.env.get(key) ?? defaultValue;
  }
  if (typeof process !== "undefined" && process.env) {
    return process.env[key] ?? defaultValue;
  }
  return defaultValue;
};

export default {
  fs: {
    type: "veryfront-api",
    veryfront: {
      apiBaseUrl: getEnv("VERYFRONT_API_BASE_URL", "https://api.veryfront.com"),
      proxyMode: true,
      cache: { enabled: true, ttl: 60000 },
      retry: { maxRetries: 3, initialDelay: 500, maxDelay: 5000 },
    },
  },
};
