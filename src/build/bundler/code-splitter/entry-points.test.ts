import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { assertThrows } from "#veryfront/testing/assert.ts";
import { convertPathToName, createEntryPoints } from "./entry-points.ts";

describe("entry-points", () => {
  describe("createEntryPoints", () => {
    it("should create entry points from routes", () => {
      const routes = [
        { path: "/", file: "/project/pages/index.tsx" },
        { path: "/about", file: "/project/pages/about.tsx" },
      ];
      const result = createEntryPoints(routes);

      expect(result.entryPoints).toEqual({
        index: "/project/pages/index.tsx",
        about: "/project/pages/about.tsx",
      });
      expect(result.routeMap.get("index")).toBe("/");
      expect(result.routeMap.get("about")).toBe("/about");
    });

    it("should use custom name when provided", () => {
      const routes = [
        {
          path: "/blog/post",
          file: "/project/pages/blog/post.tsx",
          name: "blog-post-custom",
        },
      ];
      const result = createEntryPoints(routes);

      expect(result.entryPoints).toEqual({
        "blog-post-custom": "/project/pages/blog/post.tsx",
      });
      expect(result.routeMap.get("blog-post-custom")).toBe("/blog/post");
    });

    it("stores special entry names without mutating the entry-point record prototype", () => {
      const result = createEntryPoints([{
        path: "/prototype-test",
        file: "/project/pages/prototype-test.tsx",
        name: "__proto__",
      }]);

      expect(Object.getPrototypeOf(result.entryPoints)).toBe(null);
      expect(Object.hasOwn(result.entryPoints, "__proto__")).toBe(true);
      expect(result.entryPoints.__proto__).toBe("/project/pages/prototype-test.tsx");
    });

    it("should generate name from path when name not provided", () => {
      const routes = [{ path: "/blog/post", file: "/project/pages/blog/post.tsx" }];
      const result = createEntryPoints(routes);

      expect(result.entryPoints).toEqual({
        "blog-post": "/project/pages/blog/post.tsx",
      });
    });

    it("should handle empty routes array", () => {
      const result = createEntryPoints([]);

      expect(result.entryPoints).toEqual({});
      expect(result.routeMap.size).toBe(0);
    });

    it("should handle single route", () => {
      const routes = [{ path: "/", file: "/project/pages/index.tsx" }];
      const result = createEntryPoints(routes);

      expect(Object.keys(result.entryPoints)).toHaveLength(1);
      expect(result.routeMap.size).toBe(1);
    });

    it("should handle multiple routes with mixed names", () => {
      const routes = [
        { path: "/", file: "/project/pages/index.tsx" },
        { path: "/about", file: "/project/pages/about.tsx", name: "about-page" },
        { path: "/contact", file: "/project/pages/contact.tsx" },
      ];
      const result = createEntryPoints(routes);

      expect(result.entryPoints).toEqual({
        index: "/project/pages/index.tsx",
        "about-page": "/project/pages/about.tsx",
        contact: "/project/pages/contact.tsx",
      });
    });

    it("should create route map with correct mappings", () => {
      const routes = [
        { path: "/", file: "/project/pages/index.tsx" },
        { path: "/blog", file: "/project/pages/blog.tsx" },
      ];
      const result = createEntryPoints(routes);

      expect(result.routeMap.get("index")).toBe("/");
      expect(result.routeMap.get("blog")).toBe("/blog");
    });

    it("should handle nested routes", () => {
      const routes = [{ path: "/blog/post/detail", file: "/project/pages/blog/post/detail.tsx" }];
      const result = createEntryPoints(routes);

      expect(result.entryPoints).toEqual({
        "blog-post-detail": "/project/pages/blog/post/detail.tsx",
      });
    });

    it("rejects entry-name collisions instead of overwriting a route", () => {
      assertThrows(
        () =>
          createEntryPoints([
            { path: "/a/b", file: "/project/pages/a/b.tsx" },
            { path: "/a-b", file: "/project/pages/a-b.tsx" },
          ]),
        TypeError,
        "Duplicate code-splitter entry name",
      );
    });

    it("rejects custom entry names that can escape the output directory", () => {
      assertThrows(
        () =>
          createEntryPoints([
            { path: "/admin", file: "/project/pages/admin.tsx", name: "../admin" },
          ]),
        TypeError,
        "Invalid code-splitter entry name",
      );
    });

    it("rejects duplicate route paths", () => {
      assertThrows(
        () =>
          createEntryPoints([
            { path: "/account", file: "/project/pages/account.tsx", name: "account" },
            { path: "/account", file: "/project/pages/profile.tsx", name: "profile" },
          ]),
        TypeError,
        "Duplicate code-splitter route path",
      );
    });

    it("rejects non-canonical and traversal route paths", () => {
      for (
        const path of [
          "about",
          "//about",
          "/about/",
          "/a//b",
          "/../admin",
          "/a/./b",
          "/a?b",
          "/a#b",
          "/a\\b",
        ]
      ) {
        assertThrows(
          () => createEntryPoints([{ path, file: "/project/page.tsx" }]),
          TypeError,
          "Invalid code-splitter route path",
        );
      }
    });
  });

  describe("convertPathToName", () => {
    const cases: Array<[string, string]> = [
      ["/", "index"],
      ["/about", "about"],
      ["/blog/post", "blog-post"],
      ["/contact", "contact"],
      ["/blog/post/detail", "blog-post-detail"],
      ["/users/profile/settings", "users-profile-settings"],
      ["/about/", "about-"],
      ["about", "about"],
      ["/blog//post", "blog--post"],
      ["/my-blog/my-post", "my-blog-my-post"],
      ["/2024/01", "2024-01"],
      ["/blog/post-123", "blog-post-123"],
    ];

    for (const [input, expected] of cases) {
      it(`should convert ${JSON.stringify(input)} to ${JSON.stringify(expected)}`, () => {
        expect(convertPathToName(input)).toBe(expected);
      });
    }
  });

  describe("integration", () => {
    it("should work end-to-end with typical routes", () => {
      const routes = [
        { path: "/", file: "/project/pages/index.tsx" },
        { path: "/about", file: "/project/pages/about.tsx" },
        { path: "/blog/[slug]", file: "/project/pages/blog/[slug].tsx" },
        { path: "/users/[id]/profile", file: "/project/pages/users/[id]/profile.tsx" },
      ];
      const result = createEntryPoints(routes);

      expect(result.entryPoints).toEqual({
        index: "/project/pages/index.tsx",
        about: "/project/pages/about.tsx",
        "blog-[slug]": "/project/pages/blog/[slug].tsx",
        "users-[id]-profile": "/project/pages/users/[id]/profile.tsx",
      });

      expect(result.routeMap.get("index")).toBe("/");
      expect(result.routeMap.get("about")).toBe("/about");
      expect(result.routeMap.get("blog-[slug]")).toBe("/blog/[slug]");
      expect(result.routeMap.get("users-[id]-profile")).toBe("/users/[id]/profile");
    });
  });
});
