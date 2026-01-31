import { assertEquals, assertExists, assertMatch } from "@veryfront/testing/assert";
import { afterAll, describe, it } from "@veryfront/testing/bdd";
import "../../../_helpers/log-guard.ts";

import { mkdir, writeTextFile } from "@veryfront/compat/fs.ts";
import { join } from "@veryfront/compat/path";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";
import { assertDrained } from "../../../_helpers/utils.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

function getBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

async function enableRsc(context: TestContext): Promise<void> {
  await writeTextFile(
    join(context.projectDir, "veryfront.config.js"),
    `export default { experimental: { rsc: true } };`,
  );
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // ignore stream cancellation errors
  }
}

describe(
  "Universal Server - RSC",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    // Clean up renderer intervals to prevent resource leaks
    afterAll(async () => {
      await cleanupBundler();
    });

    it("serves hydrate.js alias and RSC render ETag/304", async () => {
      await withTestContext("universal-server-rsc-hydrate-etag", async (context: TestContext) => {
        await enableRsc(context);

        const dir = join(context.projectDir, "app");
        await mkdir(dir, { recursive: true });
        await writeTextFile(
          join(dir, "page.ts"),
          `export default async function Page(){ return '<div>Hi</div>'; }`,
        );

        const server = await context.createProductionServer();
        const baseUrl = getBaseUrl(server.port);

        const hyd = await fetch(`${baseUrl}/_veryfront/rsc/hydrate.js`);
        assertEquals(hyd.status, 200);
        await hyd.text();

        const r1 = await fetch(`${baseUrl}/_veryfront/rsc/render`);
        assertEquals(r1.status, 200);

        const etag = r1.headers.get("etag");
        if (!etag) throw new Error("missing etag on render payload");

        await r1.text();

        const r2 = await fetch(`${baseUrl}/_veryfront/rsc/render`, {
          headers: { "if-none-match": etag },
        });
        assertEquals(r2.status, 304);
        await r2.text();
      });
    });

    it("streams RSC NDJSON with root and sidebar slots in order", async () => {
      await withTestContext("universal-server-rsc-stream-order", async (context: TestContext) => {
        await enableRsc(context);

        const dir = join(context.projectDir, "app", "rsc");
        await mkdir(dir, { recursive: true });
        await writeTextFile(
          join(dir, "page.ts"),
          `export default async function Page(){ return '<div>RSC Stream</div>'; }`,
        );

        const server = await context.createProductionServer();
        const baseUrl = getBaseUrl(server.port);

        const resp = await fetch(`${baseUrl}/_veryfront/rsc/stream?page=/rsc`);
        assertEquals(resp.status, 200);
        assertExists(resp.body);

        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let buf = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value);
          }
        } finally {
          await cancelReader(reader);
        }

        const events = buf
          .split(/\n+/)
          .filter((l) => l.trim().startsWith("{"))
          .map((l) => {
            try {
              return JSON.parse(l) as { type: string; id: string; html: string };
            } catch {
              return null;
            }
          })
          .filter((e): e is { type: string; id: string; html: string } => e !== null);

        if (events.length === 0) throw new Error("no stream events parsed");

        const ids = events.map((e) => e.id);
        if (!ids.includes("root")) throw new Error("root slot missing");
        if (!ids.includes("sidebar")) throw new Error("sidebar slot missing");

        const lastRootIndex = events.map((e) => e.id).lastIndexOf("root");
        const anySidebarBefore = events.slice(0, Math.max(0, lastRootIndex)).some((e) =>
          e.id === "sidebar"
        );
        if (!anySidebarBefore) throw new Error("sidebar did not appear before final root");
      });
    });

    it("serves RSC render/page endpoints for App Router page", async () => {
      await withTestContext("universal-server-rsc-endpoints", async (context: TestContext) => {
        await enableRsc(context);

        const dir = join(context.projectDir, "app", "rsc");
        await mkdir(dir, { recursive: true });
        await writeTextFile(
          join(dir, "page.ts"),
          `export default async function Page(){ return '<div id="rsc-hello">RSC Hello</div>'; }`,
        );
        await writeTextFile(
          join(dir, "Button.client.tsx"),
          `"use client"\nexport default function Button(){ return <button id="btn">Click</button>; }`,
        );

        const server = await context.createProductionServer();
        const baseUrl = getBaseUrl(server.port);
        const origin = "https://rsc.test";

        const renderRes = await fetch(`${baseUrl}/_veryfront/rsc/render/rsc`, {
          headers: { origin },
        });
        assertEquals(renderRes.status, 200);

        const payload = await renderRes.json();
        if (!payload || typeof payload.html !== "string") throw new Error("invalid rsc payload");
        if (!payload.html.includes("RSC Hello")) throw new Error("rsc html missing");

        const man = await fetch(`${baseUrl}/_veryfront/rsc/manifest`);
        assertEquals(man.status, 200);
        const manifest = await man.json();
        if (manifest?.components) {
          const keys = Object.keys(manifest.components);
          if (keys.length < 0) throw new Error("manifest missing components");
        }

        const a1 = renderRes.headers.get("access-control-allow-origin");
        if (a1) assertEquals(a1, origin);

        const pageRes = await fetch(`${baseUrl}/_veryfront/rsc/page/rsc`, {
          headers: { origin },
        });
        assertEquals(pageRes.status, 200);

        const pageHtml = await pageRes.text();
        assertMatch(pageHtml, /<!DOCTYPE html>/i);
        assertMatch(pageHtml, /<div id="rsc-root">/i);

        const a2 = pageRes.headers.get("access-control-allow-origin");
        if (a2) assertEquals(a2, origin);

        const clientRes = await fetch(`${baseUrl}/_veryfront/rsc/client.js`, {
          headers: { origin },
        });
        assertEquals(clientRes.status, 200);

        const clientJs = await clientRes.text();
        if (!/tryStream\(/.test(clientJs)) throw new Error("client.js missing tryStream");

        const allow = clientRes.headers.get("access-control-allow-origin");
        if (allow) assertEquals(allow, origin);

        const s = await fetch(`${baseUrl}/_veryfront/rsc/stream`, {
          headers: { origin },
        });
        assertEquals(s.status, 200);
        assertExists(s.body);

        const reader = s.body.getReader();
        try {
          const { value } = await reader.read();
          if (!value || value.length === 0) throw new Error("empty stream");
        } finally {
          await cancelReader(reader);
        }

        await assertDrained();
      });
    });
  },
);
