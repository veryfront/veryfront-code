/**
 * Tests for entry point creation and path conversion utilities
 */

import { describe, it } from "@std/testing/bdd.ts";
import { expect } from "@std/expect";
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
        { path: "/blog/post", file: "/project/pages/blog/post.tsx", name: "blog-post-custom" },
      ];
      const result = createEntryPoints(routes);

      expect(result.entryPoints).toEqual({
        "blog-post-custom": "/project/pages/blog/post.tsx",
      });
      expect(result.routeMap.get("blog-post-custom")).toBe("/blog/post");
    });

    it("should generate name from path when name not provided", () => {
      const routes = [
        { path: "/blog/post", file: "/project/pages/blog/post.tsx" },
      ];
      const result = createEntryPoints(routes);

      expect(result.entryPoints).toEqual({
        "blog-post": "/project/pages/blog/post.tsx",
      });
    });

    it("should handle empty routes array", () => {
      const routes: Array<{ path: string; file: string; name?: string }> = [];
      const result = createEntryPoints(routes);

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
      const routes = [
        { path: "/blog/post/detail", file: "/project/pages/blog/post/detail.tsx" },
      ];
      const result = createEntryPoints(routes);

      expect(result.entryPoints).toEqual({
        "blog-post-detail": "/project/pages/blog/post/detail.tsx",
      });
    });
  });

  describe("convertPathToName", () => {
    it("should convert root path to index", () => {
      const result = convertPathToName("/");
      expect(result).toBe("index");
    });

    it("should convert simple path", () => {
      const result = convertPathToName("/about");
      expect(result).toBe("about");
    });

    it("should convert nested path with slashes to hyphens", () => {
      const result = convertPathToName("/blog/post");
      expect(result).toBe("blog-post");
    });

    it("should remove leading slash", () => {
      const result = convertPathToName("/contact");
      expect(result).toBe("contact");
    });

    it("should convert deep nested paths", () => {
      const result = convertPathToName("/blog/post/detail");
      expect(result).toBe("blog-post-detail");
    });

    it("should handle path with multiple segments", () => {
      const result = convertPathToName("/users/profile/settings");
      expect(result).toBe("users-profile-settings");
    });

    it("should handle path with trailing slash", () => {
      const result = convertPathToName("/about/");
      expect(result).toBe("about-");
    });

    it("should handle path without leading slash", () => {
      const result = convertPathToName("about");
      expect(result).toBe("about");
    });

    it("should handle empty path segments", () => {
      const result = convertPathToName("/blog//post");
      expect(result).toBe("blog--post");
    });

    it("should preserve existing hyphens in path", () => {
      const result = convertPathToName("/my-blog/my-post");
      expect(result).toBe("my-blog-my-post");
    });

    it("should handle numeric paths", () => {
      const result = convertPathToName("/2024/01");
      expect(result).toBe("2024-01");
    });

    it("should handle mixed alphanumeric paths", () => {
      const result = convertPathToName("/blog/post-123");
      expect(result).toBe("blog-post-123");
    });
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
