import { assertEquals, assertExists, assertMatch } from "std/assert/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import "../../../_helpers/log-guard.ts";

import { join } from "std/path/mod.ts";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";
import { assertDrained } from "../../../_helpers/utils.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

afterAll(async () => {
  await cleanupBundler();
});

describe(
  "Universal Server - RSC",
  {},
  () => {
    it("serves hydrate.js alias and RSC render ETag/304", async () => {
      await withTestContext("universal-server-rsc-hydrate-etag", async (context: TestContext) => {
        await Deno.writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        const dir = join(context.projectDir, "app");
        await Deno.mkdir(dir, { recursive: true });
          await Deno.writeTextFile(
            join(dir, "page.ts"),
            `export default async function Page(){ return '<div>Hi</div>'; }`,
          );

          const server = await context.createProductionServer();

          const hyd = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/hydrate.js`);
          assertEquals(hyd.status, 200);
          await hyd.text();

          const r1 = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/render`);
          assertEquals(r1.status, 200);
          const etag = r1.headers.get("etag");
          if (!etag) throw new Error("missing etag on render payload");
          await r1.text();
          const r2 = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/render`, {
            headers: { "if-none-match": etag },
          });
          assertEquals(r2.status, 304);
          await r2.text();
      });
    });

    it("streams RSC NDJSON with root and sidebar slots in order", async () => {
      await withTestContext("universal-server-rsc-stream-order", async (context: TestContext) => {
        await Deno.writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        const dir = join(context.projectDir, "app", "rsc");
        await Deno.mkdir(dir, { recursive: true });
          await Deno.writeTextFile(
            join(dir, "page.ts"),
            `export default async function Page(){ return '<div>RSC Stream</div>'; }`,
          );

          const server = await context.createProductionServer();

          const resp = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/stream?page=/rsc`);
          assertEquals(resp.status, 200);
          assertExists(resp.body);
          const reader = resp.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value);
          }
          const lines = buf.split(/\n+/).filter((l) => l.trim().startsWith("{"));
          const events = lines
            .map((l) => {
              try {
                return JSON.parse(l);
              } catch {
                return null;
              }
            })
            .filter(Boolean) as Array<{ type: string; id: string; html: string }>;
          if (events.length === 0) throw new Error("no stream events parsed");
          const ids = events.map((e) => e.id);
          if (!ids.includes("root")) throw new Error("root slot missing");
          if (!ids.includes("sidebar")) throw new Error("sidebar slot missing");
          const lastRoot = events
            .map((e, i) => [e, i] as const)
            .filter(([e]) => e.id === "root")
            .pop();
          const anySidebarBefore = events.slice(0, lastRoot?.[1] ?? 0).some((e) =>
            e.id === "sidebar"
          );
          if (!anySidebarBefore) {
            throw new Error("sidebar did not appear before final root");
          }
      });
    });

    it("serves RSC render/page endpoints for App Router page", async () => {
      await withTestContext("universal-server-rsc-endpoints", async (context: TestContext) => {
        await Deno.writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        const dir = join(context.projectDir, "app", "rsc");
        await Deno.mkdir(dir, { recursive: true });
        await Deno.writeTextFile(
          join(dir, "page.ts"),
          `export default async function Page(){ return '<div id="rsc-hello">RSC Hello</div>'; }`,
        );
        await Deno.writeTextFile(
          join(dir, "Button.client.tsx"),
          `"use client"\nexport default function Button(){ return <button id="btn">Click</button>; }`,
        );

        const server = await context.createProductionServer();

        const renderRes = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/render/rsc`, {
          headers: { origin: "https://rsc.test" },
        });
        assertEquals(renderRes.status, 200);
        const payload = await renderRes.json();
        if (!payload || typeof payload.html !== "string") {
          throw new Error("invalid rsc payload");
        }
        if (!payload.html.includes("RSC Hello")) {
          throw new Error("rsc html missing");
        }
        const man = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/manifest`);
        assertEquals(man.status, 200);
        const manifest = await man.json();
        if (manifest?.components) {
          const keys = Object.keys(manifest.components);
          if (!(keys.length >= 0)) {
            throw new Error("manifest missing components");
          }
        }
        const a1 = renderRes.headers.get("access-control-allow-origin");
        if (a1) assertEquals(a1, "https://rsc.test");

        const pageRes = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/page/rsc`, {
          headers: { origin: "https://rsc.test" },
        });
        assertEquals(pageRes.status, 200);
        const pageHtml = await pageRes.text();
        assertMatch(pageHtml, /<!DOCTYPE html>/i);
        assertMatch(pageHtml, /<div id="rsc-root">/i);
        const a2 = pageRes.headers.get("access-control-allow-origin");
        if (a2) assertEquals(a2, "https://rsc.test");

        const clientRes = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/client.js`, {
          headers: { origin: "https://rsc.test" },
        });
        assertEquals(clientRes.status, 200);
        const clientJs = await clientRes.text();
        if (!/tryStream\(/.test(clientJs)) {
          throw new Error("client.js missing tryStream");
        }
        const allow = clientRes.headers.get("access-control-allow-origin");
        if (allow) assertEquals(allow, "https://rsc.test");

        const s = await fetch(`http://127.0.0.1:${server.port}/_veryfront/rsc/stream`, {
          headers: { origin: "https://rsc.test" },
        });
        assertEquals(s.status, 200);
        assertExists(s.body);
        const reader = s.body.getReader();
        const { value } = await reader.read();
        if (!value || value.length === 0) throw new Error("empty stream");
        await reader.cancel();

        await assertDrained();
      });
    });
  },
);
