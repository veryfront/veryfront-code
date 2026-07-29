import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { StaticPathsResult } from "#veryfront/data";
import type { RouteInfo } from "#veryfront/server/build-types.ts";
import { expandPagesStaticPaths, type StaticPathsResolver } from "./static-path-expansion.ts";

function route(path: string, templatePath?: string): RouteInfo {
  return {
    path,
    file: `/project/pages/${path === "/" ? "index" : path.slice(1)}.tsx`,
    slug: path === "/" ? "index" : path.slice(1),
    ...(templatePath ? { templatePath } : {}),
  };
}

function resolver(
  values: Record<string, StaticPathsResult | null>,
  calls: string[] = [],
): StaticPathsResolver {
  return {
    getStaticPaths(slug: string) {
      calls.push(slug);
      return Promise.resolve(values[slug] ?? null);
    },
  };
}

describe("static path expansion", () => {
  it("materializes encoded concrete paths with decoded params in deterministic order", async () => {
    const calls: string[] = [];
    const expanded = await expandPagesStaticPaths(
      [
        route("/z-static"),
        route("/blog/[slug]", "/blog/[slug]"),
        route("/docs/[...parts]", "/docs/[...parts]"),
        route("/shop/[[...category]]", "/shop/[[...category]]"),
      ],
      resolver(
        {
          "blog/[slug]": {
            paths: [
              { params: { slug: "zebra" } },
              { params: { slug: "hello world" } },
            ],
            fallback: false,
          },
          "docs/[...parts]": {
            paths: [{ params: { parts: ["api", "getting started"] } }],
            fallback: false,
          },
          "shop/[[...category]]": {
            paths: [{ params: { category: [] } }],
            fallback: false,
          },
        },
        calls,
      ),
    );

    assertEquals(calls, [
      "blog/[slug]",
      "docs/[...parts]",
      "shop/[[...category]]",
    ]);
    assertEquals(
      expanded.map(({ path, slug, templatePath, params }) => ({
        path,
        slug,
        templatePath,
        params,
      })),
      [
        {
          path: "/blog/hello%20world",
          slug: "blog/hello%20world",
          templatePath: "/blog/[slug]",
          params: { slug: "hello world" },
        },
        {
          path: "/blog/zebra",
          slug: "blog/zebra",
          templatePath: "/blog/[slug]",
          params: { slug: "zebra" },
        },
        {
          path: "/docs/api/getting%20started",
          slug: "docs/api/getting%20started",
          templatePath: "/docs/[...parts]",
          params: { parts: ["api", "getting started"] },
        },
        {
          path: "/shop",
          slug: "shop",
          templatePath: "/shop/[[...category]]",
          params: { category: [] },
        },
        {
          path: "/z-static",
          slug: "z-static",
          templatePath: undefined,
          params: undefined,
        },
      ],
    );
  });

  it("rejects unsupported fallback modes instead of publishing partial output", async () => {
    for (const fallback of [true, "blocking"] as const) {
      await assertRejects(
        () =>
          expandPagesStaticPaths(
            [route("/blog/[slug]", "/blog/[slug]")],
            resolver({
              "blog/[slug]": {
                paths: [{ params: { slug: "post" } }],
                fallback,
              },
            }),
          ),
        Error,
        "fallback: false",
      );
    }
  });

  it("rejects missing, extra, incorrectly shaped, traversal, control, and lossy params", async () => {
    const cases: Array<{
      template: string;
      params: Record<string, string | string[]>;
    }> = [
      { template: "/blog/[slug]", params: {} },
      { template: "/blog/[slug]", params: { slug: "post", extra: "value" } },
      { template: "/blog/[slug]", params: { slug: ["post"] } },
      { template: "/docs/[...parts]", params: { parts: "post" } },
      { template: "/docs/[...parts]", params: { parts: [] } },
      { template: "/blog/[slug]", params: { slug: ".." } },
      { template: "/blog/[slug]", params: { slug: "line\nfeed" } },
      { template: "/blog/[slug]", params: { slug: "\uD800" } },
    ];

    for (const { template, params } of cases) {
      const slug = template.slice(1);
      await assertRejects(
        () =>
          expandPagesStaticPaths(
            [route(template, template)],
            resolver({
              [slug]: { paths: [{ params }], fallback: false },
            }),
          ),
        Error,
      );
    }
  });

  it("rejects accessor-backed params without invoking application getters", async () => {
    let reads = 0;
    const params = {} as Record<string, string>;
    Object.defineProperty(params, "slug", {
      enumerable: true,
      get() {
        reads++;
        return "hidden";
      },
    });

    await assertRejects(
      () =>
        expandPagesStaticPaths(
          [route("/blog/[slug]", "/blog/[slug]")],
          resolver({
            "blog/[slug]": { paths: [{ params }], fallback: false },
          }),
        ),
      Error,
      "data properties",
    );
    assertEquals(reads, 0);
  });

  it("rejects duplicate and portable-filesystem-colliding concrete paths", async () => {
    for (
      const paths of [
        ["same", "same"],
        ["Post", "post"],
        ["caf\u00E9", "cafe\u0301"],
        ["a\\b", "a/b"],
      ]
    ) {
      await assertRejects(
        () =>
          expandPagesStaticPaths(
            [route("/blog/[slug]", "/blog/[slug]")],
            resolver({
              "blog/[slug]": {
                paths: paths.map((slug) => ({ params: { slug } })),
                fallback: false,
              },
            }),
          ),
        Error,
        "collision",
      );
    }
  });

  it("enforces the global path-count, path-length, and catch-all segment limits", async () => {
    await assertRejects(
      () =>
        expandPagesStaticPaths(
          [route("/items/[id]", "/items/[id]")],
          resolver({
            "items/[id]": {
              paths: Array.from({ length: 10_001 }, (_, index) => ({
                params: { id: String(index) },
              })),
              fallback: false,
            },
          }),
        ),
      RangeError,
      "10,000",
    );

    await assertRejects(
      () =>
        expandPagesStaticPaths(
          [route("/items/[id]", "/items/[id]")],
          resolver({
            "items/[id]": {
              paths: [{ params: { id: "a".repeat(2_048) } }],
              fallback: false,
            },
          }),
        ),
      RangeError,
      "2,048",
    );

    await assertRejects(
      () =>
        expandPagesStaticPaths(
          [route("/docs/[...parts]", "/docs/[...parts]")],
          resolver({
            "docs/[...parts]": {
              paths: [{ params: { parts: Array.from({ length: 1_025 }, () => "x") } }],
              fallback: false,
            },
          }),
        ),
      RangeError,
      "1,024",
    );
  });

  it("enforces an aggregate UTF-8 byte budget across all materialized paths", async () => {
    const prefix = "a".repeat(1_895);
    await assertRejects(
      () =>
        expandPagesStaticPaths(
          [route("/items/[id]", "/items/[id]")],
          resolver({
            "items/[id]": {
              paths: Array.from({ length: 9_000 }, (_, index) => ({
                params: { id: `${prefix}${String(index).padStart(5, "0")}` },
              })),
              fallback: false,
            },
          }),
        ),
      RangeError,
      "aggregate UTF-8 budget",
    );
  });
});
