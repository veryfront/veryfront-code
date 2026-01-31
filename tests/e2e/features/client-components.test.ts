#!/usr/bin/env -S deno test --allow-all
/**
 * Feature Tests: Client Components
 *
 * Tests "use client" directive and client-side functionality:
 * - Components with useState
 * - Components with useEffect
 * - Mixed server/client rendering
 * - Client components with framework imports
 */

import { beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  createProject,
  ensureBinaryCompiled,
  expectPage,
  expectServer,
  fetchPage,
  pages,
  withServer,
} from "../setup/index.ts";

describe("Feature: Client Components", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  beforeAll(async () => {
    await ensureBinaryCompiled();
  });

  describe("useState Hook", () => {
    it("should render client component with useState", async () => {
      const projectDir = await createProject("client-useState", pages.clientComponent);

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withElement("content")
          .withText("Count:")
          .withoutReactErrors();

        expectServer(server).withoutReactErrors();
      });
    });

    it("should render multiple client components on same page", async () => {
      const projectDir = await createProject(
        "multi-client-components",
        `
"use client";
import { useState } from "react";
import Counter from "../components/Counter";

export default function Home() {
  const [value] = useState("parent");
  return (
    <div id="page">
      <p id="parent-state">Parent: {value}</p>
      <Counter />
    </div>
  );
}
`,
        {
          files: {
            "components/Counter.tsx": `
"use client";
import { useState } from "react";

export default function Counter() {
  const [count] = useState(0);
  return <div id="counter">Count: {count}</div>;
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withElement("parent-state")
          .withElement("counter")
          .withoutReactErrors();

        expectServer(server).withoutReactErrors();
      });
    });
  });

  describe("useEffect Hook", () => {
    it("should render client component with useEffect", async () => {
      const projectDir = await createProject(
        "client-useEffect",
        `
"use client";
import { useState, useEffect } from "react";

export default function EffectComponent() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div id="effect-component">
      <p>Client component loaded</p>
      <p id="mounted-status">Mounted: {mounted ? "yes" : "no"}</p>
    </div>
  );
}
`,
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withElement("effect-component")
          .withoutReactErrors();

        expectServer(server).withoutReactErrors();
      });
    });
  });

  describe("Client Components with Framework Imports", () => {
    it("should combine client hooks with veryfront/head", async () => {
      const projectDir = await createProject(
        "client-with-head",
        `
"use client";
import { useState } from "react";
import { Head } from "veryfront/head";

export default function ClientWithHead() {
  const [title] = useState("Dynamic Title");
  return (
    <>
      <Head><title>{title}</title></Head>
      <div id="client-head">Title: {title}</div>
    </>
  );
}
`,
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withElement("client-head")
          .withText("Dynamic Title")
          .withoutErrors();

        expectServer(server).withoutErrors();
      });
    });

    it("should combine client hooks with veryfront/router", async () => {
      const projectDir = await createProject(
        "client-with-router",
        `
"use client";
import { useState } from "react";
import { useRouter } from "veryfront/router";

export default function ClientWithRouter() {
  const [clicks, setClicks] = useState(0);
  const router = useRouter();
  return (
    <div id="client-router">
      <p>Path: {router.pathname}</p>
      <p>Clicks: {clicks}</p>
    </div>
  );
}
`,
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withElement("client-router")
          .withText("Path:")
          .withText("Clicks:")
          .withoutErrors();

        expectServer(server).withoutErrors();
      });
    });
  });

  describe("Server and Client Component Mix", () => {
    it("should render server component with client child", async () => {
      const projectDir = await createProject(
        "server-with-client-child",
        `
import ClientCounter from "../components/ClientCounter";

export default function ServerPage() {
  return (
    <div id="server-page">
      <h1>Server Rendered</h1>
      <ClientCounter />
    </div>
  );
}
`,
        {
          files: {
            "components/ClientCounter.tsx": `
"use client";
import { useState } from "react";

export default function ClientCounter() {
  const [count] = useState(42);
  return <div id="client-counter">Client Count: {count}</div>;
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withElement("server-page")
          .withElement("client-counter")
          .withText("Server Rendered")
          .withText("Client Count:")
          .withoutErrors();

        expectServer(server).withoutErrors();
      });
    });
  });
});
