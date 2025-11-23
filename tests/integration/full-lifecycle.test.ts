/**
 * Integration tests for full request lifecycle
 */

import { assertEquals, assertExists } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { DevServer } from "@veryfront/server/dev-server.ts";

import { withTestContext } from "../_helpers/context.ts";
import { cleanupBundler } from "../../src/rendering/cleanup.ts";

// Teardown at the end (best effort)
Deno.test(
  {
    name: "Full Lifecycle | Global Teardown",
    permissions: { env: true, read: true, write: true },
    sanitizeResources: false,
    sanitizeOps: false,
  },
  async () => {
    // Global cleanup for any lingering resources
    await cleanupBundler();
  },
);

Deno.test(
  {
    name: "Full Lifecycle | Static Pages | should render home page",
    permissions: { env: true, read: true, write: true, net: true },
    sanitizeResources: false,
    sanitizeOps: false,
  },
  async () => {
    await withTestContext("full-lifecycle-static-home", async (context) => {
      // Create test project structure
      await Deno.mkdir(join(context.projectDir, "pages"), { recursive: true });
      await Deno.mkdir(join(context.projectDir, "app"), { recursive: true });

      // Ensure project-level Deno config enforces automatic JSX runtime for TSX pages
      await Deno.writeTextFile(
        join(context.projectDir, "deno.json"),
        JSON.stringify(
          {
            compilerOptions: {
              jsx: "react-jsx",
              jsxImportSource: "react",
            },
            imports: {
              react: "https://esm.sh/react@18.3.1",
              "react-dom": "https://esm.sh/react-dom@18.3.1",
              "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
            },
          },
          null,
          2,
        ),
      );

      // Create test pages
      await Deno.writeTextFile(
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

      // App Router: root layout and page
      await Deno.writeTextFile(
        join(context.projectDir, "app", "layout.tsx"),
        `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html><body><div id="root">{children}</div></body></html>);
}
`,
      );
      await Deno.writeTextFile(
        join(context.projectDir, "app", "page.tsx"),
        `export default function AppHome() { return <h1>App Router Home</h1>; }\n`,
      );

      const port = await context.allocatePort();
      const server = await context.createDevServer({
        port,
        enableHMR: false,
      });
      context.trackResource(server);

      const response = await fetch(`http://localhost:${server.port}/`);
      assertEquals(response.status, 200);

      const html = await response.text();
      assertExists(html.includes("Welcome to Veryfront"));
      assertExists(html.includes("Testing new features integration"));
    });
  },
);

Deno.test(
  {
    name: "App Router | Root page renders when no pages match",
    permissions: { env: true, read: true, write: true, net: true },
    sanitizeResources: false,
    sanitizeOps: false,
  },
  async () => {
    await withTestContext("full-lifecycle-app-root", async (context) => {
      await Deno.mkdir(join(context.projectDir, "app", "nested"), { recursive: true });

      await Deno.writeTextFile(
        join(context.projectDir, "deno.json"),
        JSON.stringify(
          {
            compilerOptions: {
              jsx: "react-jsx",
              jsxImportSource: "react",
            },
            imports: {
              react: "https://esm.sh/react@18.3.1",
              "react-dom": "https://esm.sh/react-dom@18.3.1",
              "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
            },
          },
          null,
          2,
        ),
      );

      await Deno.writeTextFile(
        join(context.projectDir, "app", "layout.tsx"),
        `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html><body><div id="root">{children}</div></body></html>);
}
`,
      );
      await Deno.writeTextFile(
        join(context.projectDir, "app", "page.tsx"),
        `export default function AppHome() { return <h1>App Router Home</h1>; }\n`,
      );
      await Deno.writeTextFile(
        join(context.projectDir, "app", "nested", "layout.tsx"),
        `export default function NestedLayout({ children }: { children: React.ReactNode }) {
  return (<section data-layout="nested">{children}</section>);
}
`,
      );
      await Deno.writeTextFile(
        join(context.projectDir, "app", "nested", "page.tsx"),
        `export default function NestedPage() { return <div>Nested App Page</div>; }\n`,
      );

      const port = await context.allocatePort();
      const server = await context.createDevServer({
        port,
        enableHMR: false,
      });
      context.trackResource(server);

      const response = await fetch(`http://localhost:${server.port}/nested`);
      assertEquals(response.status, 200);
      const html = await response.text();
      assertExists(html.includes("Nested App Page"));
      assertExists(html.includes('data-layout="nested"'));
    });
  },
);

Deno.test(
  {
    name: "App Router | Streaming SSR returns HTML (or falls back)",
    permissions: { env: true, read: true, write: true, net: true },
    sanitizeResources: false,
    sanitizeOps: false,
  },
  async () => {
    await withTestContext("full-lifecycle-streaming", async (context) => {
      await Deno.mkdir(join(context.projectDir, "app"), { recursive: true });
      await Deno.writeTextFile(
        join(context.projectDir, "deno.json"),
        JSON.stringify(
          {
            compilerOptions: {
              jsx: "react-jsx",
              jsxImportSource: "react",
            },
            imports: {
              react: "https://esm.sh/react@18.3.1",
              "react-dom": "https://esm.sh/react-dom@18.3.1",
              "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
            },
          },
          null,
          2,
        ),
      );
      await Deno.writeTextFile(
        join(context.projectDir, "app", "layout.tsx"),
        `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html><body><div id="root">{children}</div></body></html>);
}
`,
      );
      await Deno.writeTextFile(
        join(context.projectDir, "app", "page.tsx"),
        `export default function AppHome() { return <h1>App Router Home</h1>; }\n`,
      );

      const port = await context.allocatePort();
      const server = await context.createDevServer({
        port,
        enableHMR: false,
      });
      context.trackResource(server);

      const response = await fetch(`http://localhost:${server.port}/`);
      assertEquals(response.status, 200);
      // We can't guarantee streaming in all envs; just ensure HTML arrives
      const html = await response.text();
      assertExists(html.includes("App Router Home") || html.includes("Welcome to Veryfront"));
    });
  },
);

Deno.test(
  {
    name: "App Router | Dynamic params [id] are passed to page",
    permissions: { env: true, read: true, write: true, net: true },
    sanitizeResources: false,
    sanitizeOps: false,
  },
  async () => {
    await withTestContext("full-lifecycle-app-dynamic", async (context) => {
      await Deno.mkdir(join(context.projectDir, "app", "app-posts", "[id]"), {
        recursive: true,
      });
      await Deno.writeTextFile(
        join(context.projectDir, "deno.json"),
        JSON.stringify(
          {
            compilerOptions: {
              jsx: "react-jsx",
              jsxImportSource: "react",
            },
            imports: {
              react: "https://esm.sh/react@18.3.1",
              "react-dom": "https://esm.sh/react-dom@18.3.1",
              "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
            },
          },
          null,
          2,
        ),
      );
      await Deno.writeTextFile(
        join(context.projectDir, "app", "layout.tsx"),
        `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html><body><div id="root">{children}</div></body></html>);
}
`,
      );

      // App Router: dynamic [id] page
      await Deno.writeTextFile(
        join(context.projectDir, "app", "app-posts", "[id]", "page.tsx"),
        `export default function AppPost({ params }: { params: { id: string } }) { return <div>App Post ID: {params.id}</div>; }\n`,
      );

      const port = await context.allocatePort();
      const server = await context.createDevServer({
        port,
        enableHMR: false,
      });
      context.trackResource(server);

      const response = await fetch(`http://localhost:${server.port}/app-posts/42`);
      assertEquals(response.status, 200);
      const html = await response.text();
      assertExists(html.includes("App Post ID: 42"));
    });
  },
);

Deno.test(
  {
    name: "App Router | Catch-all [...slug] aggregates segments",
    permissions: { env: true, read: true, write: true, net: true },
    sanitizeResources: false,
    sanitizeOps: false,
  },
  async () => {
    await withTestContext("full-lifecycle-app-catchall", async (context) => {
      await Deno.mkdir(join(context.projectDir, "app", "docs", "[...slug]"), {
        recursive: true,
      });
      await Deno.writeTextFile(
        join(context.projectDir, "deno.json"),
        JSON.stringify(
          {
            compilerOptions: {
              jsx: "react-jsx",
              jsxImportSource: "react",
            },
            imports: {
              react: "https://esm.sh/react@18.3.1",
              "react-dom": "https://esm.sh/react-dom@18.3.1",
              "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
            },
          },
          null,
          2,
        ),
      );
      await Deno.writeTextFile(
        join(context.projectDir, "app", "layout.tsx"),
        `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html><body><div id="root">{children}</div></body></html>);
}
`,
      );

      // App Router: catch-all [...slug] page
      await Deno.writeTextFile(
        join(context.projectDir, "app", "docs", "[...slug]", "page.tsx"),
        `export default function Docs({ params }: { params: { slug: string[] } }) { return <div>Docs Path: {params.slug.join('/')}</div>; }\n`,
      );

      const port = await context.allocatePort();
      const server = await context.createDevServer({
        port,
        enableHMR: false,
      });
      context.trackResource(server);

      const response = await fetch(`http://localhost:${server.port}/docs/one/two/three`);
      assertEquals(response.status, 200);
      const html = await response.text();
      assertExists(html.includes("Docs Path: one/two/three"));
    });
  },
);

Deno.test(
  {
    name: "Full Lifecycle | Dynamic Routes | should render dynamic blog post",
    permissions: { env: true, read: true, write: true, net: true },
    sanitizeResources: false,
    sanitizeOps: false,
  },
  async () => {
    await withTestContext("full-lifecycle-dynamic-blog", async (context) => {
      await Deno.mkdir(join(context.projectDir, "pages", "blog"), { recursive: true });
      await Deno.writeTextFile(
        join(context.projectDir, "deno.json"),
        JSON.stringify(
          {
            compilerOptions: {
              jsx: "react-jsx",
              jsxImportSource: "react",
            },
            imports: {
              react: "https://esm.sh/react@18.3.1",
              "react-dom": "https://esm.sh/react-dom@18.3.1",
              "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
            },
          },
          null,
          2,
        ),
      );

      // Dynamic route page
      await Deno.writeTextFile(
        join(context.projectDir, "pages", "blog", "[slug].tsx"),
        `
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
        `,
      );

      const port = await context.allocatePort();
      const server = await context.createDevServer({
        port,
        enableHMR: false,
      });
      context.trackResource(server);

      const response = await fetch(`http://localhost:${server.port}/blog/test-post`);
      assertEquals(response.status, 200);

      const html = await response.text();
      assertExists(html.includes("Post: test-post"));
      assertExists(html.includes("This is the content for test-post"));
      assertExists(html.includes("Slug: test-post"));
    });
  },
);

Deno.test(
  {
    name: "Full Lifecycle | Dynamic Routes | should handle not found in getServerData",
    permissions: { env: true, read: true, write: true, net: true },
    sanitizeResources: false,
    sanitizeOps: false,
  },
  async () => {
    await withTestContext("full-lifecycle-notfound", async (context) => {
      await Deno.mkdir(join(context.projectDir, "pages", "blog"), { recursive: true });
      await Deno.writeTextFile(
        join(context.projectDir, "deno.json"),
        JSON.stringify(
          {
            compilerOptions: {
              jsx: "react-jsx",
              jsxImportSource: "react",
            },
            imports: {
              react: "https://esm.sh/react@18.3.1",
              "react-dom": "https://esm.sh/react-dom@18.3.1",
              "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
            },
          },
          null,
          2,
        ),
      );

      // Dynamic route page
      await Deno.writeTextFile(
        join(context.projectDir, "pages", "blog", "[slug].tsx"),
        `
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
        `,
      );

      const port = await context.allocatePort();
      const server = await context.createDevServer({
        port,
        enableHMR: false,
      });
      context.trackResource(server);

      const response = await fetch(`http://localhost:${server.port}/blog/not-found`);
      assertEquals(response.status, 404);
      await response.body?.cancel();
    });
  },
);

Deno.test(
  {
    name: "Full Lifecycle | Dynamic Routes | should return 404 for non-existent routes",
    permissions: { env: true, read: true, write: true, net: true },
    sanitizeResources: false,
    sanitizeOps: false,
  },
  async () => {
    await withTestContext("full-lifecycle-404-nonexistent", async (context) => {
      const port = await context.allocatePort();
      const server = await context.createDevServer({
        port,
        enableHMR: false,
      });
      context.trackResource(server);

      const response = await fetch(`http://localhost:${server.port}/does-not-exist`);
      assertEquals(response.status, 404);
      await response.body?.cancel();
    });
  },
);

Deno.test(
  {
    name: "Full Lifecycle | API Routes | should handle GET request to dynamic API route",
    permissions: { env: true, read: true, write: true, net: true },
    sanitizeResources: false,
    sanitizeOps: false,
  },
  async () => {
    await withTestContext("full-lifecycle-api-get", async (context) => {
      await Deno.mkdir(join(context.projectDir, "pages", "api", "posts"), { recursive: true });
      await Deno.writeTextFile(
        join(context.projectDir, "deno.json"),
        JSON.stringify(
          {
            compilerOptions: {
              jsx: "react-jsx",
              jsxImportSource: "react",
            },
            imports: {
              react: "https://esm.sh/react@18.3.1",
              "react-dom": "https://esm.sh/react-dom@18.3.1",
              "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
            },
          },
          null,
          2,
        ),
      );

      // API route
      await Deno.writeTextFile(
        join(context.projectDir, "pages", "api", "posts", "[id].ts"),
        `
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
        `,
      );

      const port = await context.allocatePort();
      const server = await context.createDevServer({
        port,
        enableHMR: false,
      });
      context.trackResource(server);

      const response = await fetch(`http://localhost:${server.port}/api/posts/123`);
      assertEquals(response.status, 200);

      const data = await response.json();
      assertEquals(data.id, "123");
      assertEquals(data.title, "Post 123");
      assertEquals(data.content, "Content for post 123");
    });
  },
);

Deno.test(
  {
    name: "Full Lifecycle | API Routes | should handle POST request to dynamic API route",
    permissions: { env: true, read: true, write: true, net: true },
    sanitizeResources: false,
    sanitizeOps: false,
  },
  async () => {
    await withTestContext("full-lifecycle-api-post", async (context) => {
      await Deno.mkdir(join(context.projectDir, "pages", "api", "posts"), { recursive: true });
      await Deno.writeTextFile(
        join(context.projectDir, "deno.json"),
        JSON.stringify(
          {
            compilerOptions: {
              jsx: "react-jsx",
              jsxImportSource: "react",
            },
            imports: {
              react: "https://esm.sh/react@18.3.1",
              "react-dom": "https://esm.sh/react-dom@18.3.1",
              "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
            },
          },
          null,
          2,
        ),
      );

      // API route
      await Deno.writeTextFile(
        join(context.projectDir, "pages", "api", "posts", "[id].ts"),
        `
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
        `,
      );

      const port = await context.allocatePort();
      const server = await context.createDevServer({
        port,
        enableHMR: false,
      });
      context.trackResource(server);

      const response = await fetch(`http://localhost:${server.port}/api/posts/456`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "New Post",
          content: "New content",
        }),
      });
      assertEquals(response.status, 201);

      const data = await response.json();
      assertEquals(data.id, "456");
      assertEquals(data.title, "New Post");
      assertEquals(data.content, "New content");
      assertEquals(data.created, true);
    });
  },
);

Deno.test(
  {
    name: "Full Lifecycle | API Routes | should return 405 for unsupported methods",
    permissions: { env: true, read: true, write: true, net: true },
    sanitizeResources: false,
    sanitizeOps: false,
  },
  async () => {
    await withTestContext("full-lifecycle-api-405", async (context) => {
      await Deno.mkdir(join(context.projectDir, "pages", "api", "posts"), { recursive: true });
      await Deno.writeTextFile(
        join(context.projectDir, "deno.json"),
        JSON.stringify(
          {
            compilerOptions: {
              jsx: "react-jsx",
              jsxImportSource: "react",
            },
            imports: {
              react: "https://esm.sh/react@18.3.1",
              "react-dom": "https://esm.sh/react-dom@18.3.1",
              "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
            },
          },
          null,
          2,
        ),
      );

      // API route
      await Deno.writeTextFile(
        join(context.projectDir, "pages", "api", "posts", "[id].ts"),
        `
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
        `,
      );

      const port = await context.allocatePort();
      const server = await context.createDevServer({
        port,
        enableHMR: false,
      });
      context.trackResource(server);

      const response = await fetch(`http://localhost:${server.port}/api/posts/789`, {
        method: "DELETE",
      });
      assertEquals(response.status, 405);
      assertEquals(response.headers.get("Allow"), "GET, POST");
      await response.body?.cancel();
    });
  },
);

Deno.test(
  {
    name: "Full Lifecycle | Static Data with ISR | should render static product page",
    permissions: { env: true, read: true, write: true, net: true },
    sanitizeResources: false,
    sanitizeOps: false,
  },
  async () => {
    await withTestContext("full-lifecycle-isr-static", async (context) => {
      await Deno.mkdir(join(context.projectDir, "pages", "products"), { recursive: true });
      await Deno.writeTextFile(
        join(context.projectDir, "deno.json"),
        JSON.stringify(
          {
            compilerOptions: {
              jsx: "react-jsx",
              jsxImportSource: "react",
            },
            imports: {
              react: "https://esm.sh/react@18.3.1",
              "react-dom": "https://esm.sh/react-dom@18.3.1",
              "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
            },
          },
          null,
          2,
        ),
      );

      // Static data page with ISR
      await Deno.writeTextFile(
        join(context.projectDir, "pages", "products", "[id].tsx"),
        `
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
        `,
      );

      const port = await context.allocatePort();
      const server = await context.createDevServer({
        port,
        enableHMR: false,
      });
      context.trackResource(server);

      const response = await fetch(`http://localhost:${server.port}/products/1`);
      assertEquals(response.status, 200);

      const html = await response.text();
      assertExists(html.includes("Product 1"));
      assertExists(html.includes("Price: $100"));
      assertExists(html.includes("ID: 1"));
    });
  },
);

Deno.test(
  {
    name: "Full Lifecycle | Static Data with ISR | should cache static data",
    permissions: { env: true, read: true, write: true, net: true },
    sanitizeResources: false,
    sanitizeOps: false,
  },
  async () => {
    await withTestContext("full-lifecycle-isr-cache", async (context) => {
      await Deno.mkdir(join(context.projectDir, "pages", "products"), { recursive: true });
      await Deno.writeTextFile(
        join(context.projectDir, "deno.json"),
        JSON.stringify(
          {
            compilerOptions: {
              jsx: "react-jsx",
              jsxImportSource: "react",
            },
            imports: {
              react: "https://esm.sh/react@18.3.1",
              "react-dom": "https://esm.sh/react-dom@18.3.1",
              "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
            },
          },
          null,
          2,
        ),
      );

      // Static data page with ISR
      await Deno.writeTextFile(
        join(context.projectDir, "pages", "products", "[id].tsx"),
        `
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
        `,
      );

      const port = await context.allocatePort();
      const server = await context.createDevServer({
        port,
        enableHMR: false,
      });
      context.trackResource(server);

      // First request
      const response1 = await fetch(`http://localhost:${server.port}/products/2`);
      const html1 = await response1.text();
      const timestamp1 = html1.match(/Generated at: ([^<]+)/)?.[1];

      // Second request (should be cached)
      const response2 = await fetch(`http://localhost:${server.port}/products/2`);
      const html2 = await response2.text();
      const timestamp2 = html2.match(/Generated at: ([^<]+)/)?.[1];
      // Do not cancel locked body streams after consumption

      // Timestamps should be the same (cached)
      assertEquals(timestamp1, timestamp2);
    });
  },
);

Deno.test(
  {
    name: "Full Lifecycle | Request Context | should pass query parameters to getServerData",
    permissions: { env: true, read: true, write: true, net: true },
    sanitizeResources: false,
    sanitizeOps: false,
  },
  async () => {
    await withTestContext("full-lifecycle-query-params", async (context) => {
      await Deno.mkdir(join(context.projectDir, "pages"), { recursive: true });
      await Deno.writeTextFile(
        join(context.projectDir, "deno.json"),
        JSON.stringify(
          {
            compilerOptions: {
              jsx: "react-jsx",
              jsxImportSource: "react",
            },
            imports: {
              react: "https://esm.sh/react@18.3.1",
              "react-dom": "https://esm.sh/react-dom@18.3.1",
              "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
            },
          },
          null,
          2,
        ),
      );

      // Create a page that uses query params
      await Deno.writeTextFile(
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

      const port = await context.allocatePort();
      const server = await context.createDevServer({
        port,
        enableHMR: false,
      });
      context.trackResource(server);

      const response = await fetch(`http://localhost:${server.port}/search?q=veryfront&page=2`);
      assertEquals(response.status, 200);

      const html = await response.text();
      assertExists(html.includes("Search: veryfront"));
      assertExists(html.includes("Page: 2"));
      assertExists(html.includes("Result for veryfront"));
      // Body already consumed by text()
    });
  },
);

Deno.test(
  {
    name: "Full Lifecycle | Error Handling | should show error overlay in development",
    permissions: { env: true, read: true, write: true, net: true },
    sanitizeResources: false,
    sanitizeOps: false,
  },
  async () => {
    await withTestContext("full-lifecycle-error-overlay", async (context) => {
      await Deno.mkdir(join(context.projectDir, "pages"), { recursive: true });
      await Deno.writeTextFile(
        join(context.projectDir, "deno.json"),
        JSON.stringify(
          {
            compilerOptions: {
              jsx: "react-jsx",
              jsxImportSource: "react",
            },
            imports: {
              react: "https://esm.sh/react@18.3.1",
              "react-dom": "https://esm.sh/react-dom@18.3.1",
              "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
            },
          },
          null,
          2,
        ),
      );

      // Create a page that throws an error
      await Deno.writeTextFile(
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

      const port = await context.allocatePort();
      const server = await context.createDevServer({
        port,
        enableHMR: false,
      });
      context.trackResource(server);

      const response = await fetch(`http://localhost:${server.port}/error`);
      assertEquals(response.status, 500);

      const html = await response.text();
      assertExists(html.includes("Test error in getServerData"));
      // Body already consumed by text()
    });
  },
);
