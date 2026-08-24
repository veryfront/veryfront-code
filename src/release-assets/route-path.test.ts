import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  configuredRoutePath,
  normalizeLogicalPath,
  pathBelowRoot,
  routeForConfiguredPage,
  routeForPage,
} from "./route-path.ts";

describe("release-assets/route-path", () => {
  it("derives nested index routes correctly", () => {
    assertEquals(routeForPage("pages/index.tsx"), "/");
    assertEquals(routeForPage("pages/about.tsx"), "/about");
    assertEquals(routeForPage("pages/blog/index.tsx"), "/blog");
    assertEquals(routeForPage("pages/blog/post.tsx"), "/blog/post");
    assertEquals(routeForPage("pages/a/b/index.tsx"), "/a/b");
    assertEquals(routeForPage("pages/api/hello.ts"), null);
    assertEquals(routeForPage("pages/api/users/[id].ts"), null);
    assertEquals(routeForPage("pages/index.d.ts"), null);
    assertEquals(routeForPage("pages/blog/post.d.ts"), null);
    assertEquals(routeForPage("pages/index.css"), null);
    assertEquals(routeForPage("pages/_app.tsx"), null);
    assertEquals(routeForPage("pages/_document.tsx"), null);
    assertEquals(routeForPage("pages/blog/_draft.tsx"), null);
    assertEquals(routeForPage("app/page.tsx"), "/");
    assertEquals(routeForPage("app/(marketing)/page.tsx"), "/");
    assertEquals(routeForPage("app/(marketing)/blog/page.tsx"), "/blog");
    assertEquals(routeForPage("app/page.d.ts"), null);
    assertEquals(routeForPage("app/page.css"), null);
    assertEquals(routeForPage("app/@modal/page.tsx"), null);
    assertEquals(routeForPage("app/_components/page.tsx"), null);
    assertEquals(routeForPage("components/Button.tsx"), null);
  });

  it("normalizes logical paths before matching configured route roots", () => {
    const directories = { app: "src\\site", pages: "src/pages" };

    assertEquals(normalizeLogicalPath("src\\site/./blog/../page.tsx"), "src/site/page.tsx");
    assertEquals(pathBelowRoot("src\\pages\\about.tsx", "src/pages"), "about.tsx");
    assertEquals(configuredRoutePath("src\\site\\page.tsx", directories, "app"), "app/page.tsx");
    assertEquals(routeForConfiguredPage("src\\pages\\about.tsx", directories), "/about");
  });

  it("tries the pages root when the app root matches but the file is not an app route", () => {
    // Nested roots: every pages file also lives below the app root, so the
    // app lookup must fall through instead of deciding the answer.
    const nested = { app: "src", pages: "src/pages" };

    assertEquals(
      routeForConfiguredPage("src/page.tsx", nested),
      "/",
      "the app root must still win when the file is an app route",
    );
    assertEquals(
      routeForConfiguredPage("src/pages/about.tsx", nested),
      "/about",
      "a path below the app root that is not an app route must still resolve under the pages root",
    );
  });
});
