/**
 * Veryfront Config for local development
 */
export default {
  router: "pages" as const,
  app: "components/app.tsx",
  layout: "components/layouts/DefaultLayout.mdx",
  dev: {
    port: 3003,
    host: "localhost",
    hmr: true,
  },
};
