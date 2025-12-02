import { defineConfig } from "veryfront";

// Note: Custom middleware that returns Response objects directly causes
// "TypeError: immutable" errors because the framework tries to modify
// the response headers after creation. Auth is handled at the page level
// instead - see dashboard/page.tsx which checks /api/auth/me and redirects.

export default defineConfig({
  router: "app",
});
