/**********
 * Integration tests for full request lifecycle
 **********/

// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assert, assertEquals } from "#veryfront/testing/assert";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd";
import { join } from "#veryfront/compat/path";
import { mkdir, remove, writeTextFile } from "#veryfront/testing/deno-compat";

import { withTestContext } from "../_helpers/context.ts";
import { cleanupBundler } from "../../src/rendering/cleanup.ts";
import { createTestDenoConfig } from "../_helpers/import-maps.ts";

async function writeDenoConfig(projectDir: string): Promise<void> {
  await writeTextFile(join(projectDir, "deno.json"), createTestDenoConfig());
}

async function startServer(context: {
  allocatePort: () => Promise<number>;
  createDevServer: (opts: { port: number; enableHMR: boolean }) => Promise<{ port: number }>;
  trackResource: (resource: unknown) => void;
}): Promise<{ port: number }> {
  const port = await context.allocatePort();
  const server = await context.createDevServer({ port, enableHMR: false });
  context.trackResource(server);
  return server;
}

const rootLayout = `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html><body><div id="root">{children}</div></body></html>);
}
`;

const apiRoute = `
export const GET = (ctx) => {
  const id = ctx.params.id;
  return Response.json({
    id,
    title: \`Post \${id}\`,
    content: \`Content for post \${id}\`
  });
};

export const POST = async (ctx) => {
  const body = await ctx.request.json();
  return Response.json({
    id: ctx.params.id,
    ...body,
    created: true
  }, { status: 201 });
};
`;

const isrProductPage = `
export function getStaticData(context) {
  const id = context.params.id;

  return {
    props: {
      id,
      name: \`Product \${id}\`,
      price: parseInt(id) * 100,
      timestamp: Date.now()
    },
    revalidate: 60
  };
}

export function getStaticPaths() {
  return {
    paths: [
      { params: { id: '1' } },
      { params: { id: '2' } },
      { params: { id: '3' } }
    ],
    fallback: 'blocking'
  };
}

export default function ProductPage({ id, name, price, timestamp }) {
  return (<div>
      <h1>{name}</h1>
      <p>Price: {price}</p>
      <p>ID: {id}</p>
      <small>Generated at: {new Date(timestamp).toISOString()}</small>
    </div>);
}
`;

const blogPostPage = `
export function getServerData(context) {
  const slug = context.params.slug;

  if (slug === 'not-found') {
    return { notFound: true };
  }

  return {
    props: {
      slug,
      title: \`Post: \${slug}\`,
      content: \`This is the content for \${slug}\`
    }
  };
}

export default function BlogPost({ slug, title, content }) {
  return (<article>
      <h1>{title}</h1>
      <p>{content}</p>
      <small>Slug: {slug}</small>
    </article>);
}
`;

describe(
  "Full Lifecycle",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    beforeAll(async () => {
      // Clear framework cache to prevent cross-environment contamination
      // (e.g., compiled binary e2e tests leaving stale caches that break source-based tests)
      const frameworkCacheDir = join(Deno.cwd(), ".cache", "veryfront-mdx-esm", "framework");
      const singleCacheDir = join(Deno.cwd(), ".cache", "veryfront-mdx-esm", "__single__");

      await Promise.all([
        remove(frameworkCacheDir, { recursive: true }).catch(() => {}),
        remove(singleCacheDir, { recursive: true }).catch(() => {}),
      ]);
    });

    afterAll(async () => {
      // Global cleanup for any lingering resources
      await cleanupBundler();
    });

    describe("Static Pages", () => {
      it("should render home page", async () => {
        await withTestContext("full-lifecycle-static-home", async (context) => {
          await mkdir(join(context.projectDir, "pages"), { recursive: true });
          await writeDenoConfig(context.projectDir);

          await writeTextFile(
            join(context.projectDir, "pages", "index.tsx"),
            `
export default function HomePage() {
  return (<div>
      <h1>Welcome to Veryfront</h1>
      <p>Testing new features integration</p>
    </div>);
}
        `,
          );

          const server = await startServer(context);

          const response = await fetch(`http://127.0.0.1:${server.port}/`);
          assertEquals(response.status, 200);

          const html = await response.text();
          assert(html.includes("Welcome to Veryfront"));
          assert(html.includes("Testing new features integration"));
        });
      });
    });

    describe("App Router", () => {
      it("root page renders when no pages match", async () => {
        await withTestContext("full-lifecycle-app-root", async (context) => {
          await mkdir(join(context.projectDir, "app", "nested"), { recursive: true });
          await writeDenoConfig(context.projectDir);

          await writeTextFile(join(context.projectDir, "app", "layout.tsx"), rootLayout);
          await writeTextFile(
            join(context.projectDir, "app", "page.tsx"),
            `export default function AppHome() { return <h1>App Router Home</h1>; }\n`,
          );
          await writeTextFile(
            join(context.projectDir, "app", "nested", "layout.tsx"),
            `export default function NestedLayout({ children }: { children: React.ReactNode }) {
  return (<section data-layout="nested">{children}</section>);
}
`,
          );
          await writeTextFile(
            join(context.projectDir, "app", "nested", "page.tsx"),
            `export default function NestedPage() { return <div>Nested App Page</div>; }\n`,
          );

          const server = await startServer(context);

          const response = await fetch(`http://127.0.0.1:${server.port}/nested`);
          assertEquals(response.status, 200);

          const html = await response.text();
          assert(html.includes("Nested App Page"));
          assert(html.includes('data-layout="nested"'));
        });
      });

      it("streaming SSR returns HTML (or falls back)", async () => {
        await withTestContext("full-lifecycle-streaming", async (context) => {
          await mkdir(join(context.projectDir, "app"), { recursive: true });
          await writeDenoConfig(context.projectDir);

          await writeTextFile(join(context.projectDir, "app", "layout.tsx"), rootLayout);
          await writeTextFile(
            join(context.projectDir, "app", "page.tsx"),
            `export default function AppHome() { return <h1>App Router Home</h1>; }\n`,
          );

          const server = await startServer(context);

          const response = await fetch(`http://127.0.0.1:${server.port}/`);
          assertEquals(response.status, 200);

          // We can't guarantee streaming in all envs; just ensure HTML arrives
          const html = await response.text();
          assert(html.includes("App Router Home") || html.includes("Welcome to Veryfront"));
        });
      });

      it("dynamic params [id] are passed to page", async () => {
        await withTestContext("full-lifecycle-app-dynamic", async (context) => {
          await mkdir(join(context.projectDir, "app", "app-posts", "[id]"), { recursive: true });
          await writeDenoConfig(context.projectDir);

          await writeTextFile(join(context.projectDir, "app", "layout.tsx"), rootLayout);
          await writeTextFile(
            join(context.projectDir, "app", "app-posts", "[id]", "page.tsx"),
            `export default function AppPost({ params }: { params: { id: string } }) { return <div>App Post ID: {params.id}</div>; }\n`,
          );

          const server = await startServer(context);

          const response = await fetch(`http://127.0.0.1:${server.port}/app-posts/42`);
          assertEquals(response.status, 200);

          const html = await response.text();
          assert(
            html.includes("App Post ID:") && html.includes("42"),
            `Expected "App Post ID:" and "42" but got: ${html}`,
          );
        });
      });

      it("catch-all [...slug] aggregates segments", async () => {
        await withTestContext("full-lifecycle-app-catchall", async (context) => {
          await mkdir(join(context.projectDir, "app", "docs", "[...slug]"), { recursive: true });
          await writeDenoConfig(context.projectDir);

          await writeTextFile(join(context.projectDir, "app", "layout.tsx"), rootLayout);
          await writeTextFile(
            join(context.projectDir, "app", "docs", "[...slug]", "page.tsx"),
            `export default function Docs({ params }: { params: { slug: string[] } }) { return <div>Docs Path: {params.slug.join('/')}</div>; }\n`,
          );

          const server = await startServer(context);

          const response = await fetch(`http://127.0.0.1:${server.port}/docs/one/two/three`);
          assertEquals(response.status, 200);

          const html = await response.text();
          assert(
            html.includes("Docs Path:") && html.includes("one/two/three"),
            `Expected "Docs Path:" and "one/two/three" but got: ${html}`,
          );
        });
      });
    });

    describe("Dynamic Routes", () => {
      it("should render dynamic blog post", async () => {
        await withTestContext("full-lifecycle-dynamic-blog", async (context) => {
          await mkdir(join(context.projectDir, "pages", "blog"), { recursive: true });
          await writeDenoConfig(context.projectDir);

          await writeTextFile(join(context.projectDir, "pages", "blog", "[slug].tsx"), blogPostPage);

          const server = await startServer(context);

          const response = await fetch(`http://127.0.0.1:${server.port}/blog/test-post`);
          assertEquals(response.status, 200);

          const html = await response.text();
          assert(html.includes("Post:") && html.includes("test-post"), `Expected "Post:" and "test-post" in HTML`);
          assert(
            html.includes("This is the content for") && html.includes("test-post"),
            `Expected content text in HTML`,
          );
          assert(html.includes("Slug:") && html.includes("test-post"), `Expected "Slug:" and "test-post" in HTML`);
        });
      });

      it("should handle not found in getServerData", async () => {
        await withTestContext("full-lifecycle-notfound", async (context) => {
          await mkdir(join(context.projectDir, "pages", "blog"), { recursive: true });
          await writeDenoConfig(context.projectDir);

          await writeTextFile(join(context.projectDir, "pages", "blog", "[slug].tsx"), blogPostPage);

          const server = await startServer(context);

          const response = await fetch(`http://127.0.0.1:${server.port}/blog/not-found`);
          assertEquals(response.status, 404);
          await response.body?.cancel();
        });
      });

      it("should return 404 for non-existent routes", async () => {
        await withTestContext("full-lifecycle-404-nonexistent", async (context) => {
          const server = await startServer(context);

          const response = await fetch(`http://127.0.0.1:${server.port}/does-not-exist`);
          assertEquals(response.status, 404);
          await response.body?.cancel();
        });
      });
    });

    describe("API Routes", () => {
      async function setupApiProject(context: { projectDir: string }): Promise<void> {
        // Remove default app directory to use pages router
        await remove(join(context.projectDir, "app"), { recursive: true });
        await mkdir(join(context.projectDir, "pages", "api", "posts"), { recursive: true });
        await writeDenoConfig(context.projectDir);

        await writeTextFile(join(context.projectDir, "pages", "api", "posts", "[id].ts"), apiRoute);
      }

      it("should handle GET request to dynamic API route", async () => {
        await withTestContext("full-lifecycle-api-get", async (context) => {
          await setupApiProject(context);

          const server = await startServer(context);

          const response = await fetch(`http://127.0.0.1:${server.port}/api/posts/123`);
          assertEquals(response.status, 200);

          const data = await response.json();
          assertEquals(data.id, "123");
          assertEquals(data.title, "Post 123");
          assertEquals(data.content, "Content for post 123");
        });
      });

      it("should handle POST request to dynamic API route", async () => {
        await withTestContext("full-lifecycle-api-post", async (context) => {
          await setupApiProject(context);

          const server = await startServer(context);

          const response = await fetch(`http://127.0.0.1:${server.port}/api/posts/456`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "New Post", content: "New content" }),
          });
          assertEquals(response.status, 201);

          const data = await response.json();
          assertEquals(data.id, "456");
          assertEquals(data.title, "New Post");
          assertEquals(data.content, "New content");
          assertEquals(data.created, true);
        });
      });

      it("should return 405 for unsupported methods", async () => {
        await withTestContext("full-lifecycle-api-405", async (context) => {
          await setupApiProject(context);

          const server = await startServer(context);

          const response = await fetch(`http://127.0.0.1:${server.port}/api/posts/789`, { method: "DELETE" });
          assertEquals(response.status, 405);
          assertEquals(response.headers.get("Allow"), "GET, POST");
          await response.body?.cancel();
        });
      });
    });

    describe("Static Data with ISR", () => {
      it("should render static product page", async () => {
        await withTestContext("full-lifecycle-isr-static", async (context) => {
          await mkdir(join(context.projectDir, "pages", "products"), { recursive: true });
          await writeDenoConfig(context.projectDir);

          await writeTextFile(join(context.projectDir, "pages", "products", "[id].tsx"), isrProductPage);

          const server = await startServer(context);

          const response = await fetch(`http://127.0.0.1:${server.port}/products/1`);
          assertEquals(response.status, 200);

          const html = await response.text();
          assert(html.includes("Product") && html.includes("1"), `Expected "Product" and "1" in HTML`);
          assert(html.includes("Price:") && html.includes("100"), `Expected "Price:" and "100" in HTML`);
          assert(html.includes("ID:") && html.includes("1"), `Expected "ID:" and "1" in HTML`);
        });
      });

      it("should cache static data", async () => {
        await withTestContext("full-lifecycle-isr-cache", async (context) => {
          await mkdir(join(context.projectDir, "pages", "products"), { recursive: true });
          await writeDenoConfig(context.projectDir);

          await writeTextFile(join(context.projectDir, "pages", "products", "[id].tsx"), isrProductPage);

          const server = await startServer(context);

          const response1 = await fetch(`http://127.0.0.1:${server.port}/products/2`);
          const html1 = await response1.text();
          const timestamp1 = html1.match(/Generated at: ([^<]+)/)?.[1];

          const response2 = await fetch(`http://127.0.0.1:${server.port}/products/2`);
          const html2 = await response2.text();
          const timestamp2 = html2.match(/Generated at: ([^<]+)/)?.[1];

          assertEquals(timestamp1, timestamp2);
        });
      });
    });

    describe("Request Context", () => {
      it("should pass query parameters to getServerData", async () => {
        await withTestContext("full-lifecycle-query-params", async (context) => {
          await mkdir(join(context.projectDir, "pages"), { recursive: true });
          await writeDenoConfig(context.projectDir);

          await writeTextFile(
            join(context.projectDir, "pages", "search.tsx"),
            `
export function getServerData(context) {
  const q = context.query.get('q');
  const page = context.query.get('page') || '1';

  return {
    props: {
      query: q,
      page: parseInt(page),
      results: q ? [
        \`Result for \${q}\`
      ] : []
    }
  };
}

export default function SearchPage({ query, page, results }) {
  return (<div>
      <h1>Search: {query || 'No query'}</h1>
      <p>Page: {page}</p>
      <ul>
        {results.map((r, i) => <li key={i}>{r}</li>)}
      </ul>
    </div>);
}
      `,
          );

          const server = await startServer(context);

          const response = await fetch(`http://127.0.0.1:${server.port}/search?q=veryfront&page=2`);
          assertEquals(response.status, 200);

          const html = await response.text();
          assert(html.includes("Search:") && html.includes("veryfront"), `Expected "Search:" and "veryfront" in HTML`);
          assert(html.includes("Page:") && html.includes("2"), `Expected "Page:" and "2" in HTML`);
          assert(
            html.includes("Result for") && html.includes("veryfront"),
            `Expected "Result for" and "veryfront" in HTML`,
          );
        });
      });
    });

    describe("Error Handling", () => {
      it("should show error overlay in development", async () => {
        await withTestContext("full-lifecycle-error-overlay", async (context) => {
          await mkdir(join(context.projectDir, "pages"), { recursive: true });
          await writeDenoConfig(context.projectDir);

          await writeTextFile(
            join(context.projectDir, "pages", "error.tsx"),
            `
export function getServerData() {
  throw new Error("Test error in getServerData");
}

export default function ErrorPage() {
  return <div>This won't render</div>;
}
        `,
          );

          const server = await startServer(context);

          const response = await fetch(`http://127.0.0.1:${server.port}/error`);
          assertEquals(response.status, 500);

          const html = await response.text();
          assert(html.includes("Test error in getServerData"));
        });
      });
    });
  },
);
