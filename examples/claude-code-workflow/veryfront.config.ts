export default {
  router: "app" as const,
  fs: {
    type: "local" as const,
  },
  dev: {
    port: 3002,
    host: "localhost",
    hmr: true,
  },
  security: {
    cors: true,
  },
};
