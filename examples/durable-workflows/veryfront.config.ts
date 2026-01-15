/**
 * Local dev config for durable-workflows example
 *
 * Workflows in ai/workflows/ are auto-discovered like tools, agents, etc.
 */

export default {
  // Use local filesystem
  fs: {
    type: "local" as const,
  },

  // Dev server config
  dev: {
    port: 3002,
    host: "localhost",
    hmr: true,
  },
};
