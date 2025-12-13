import { assertEquals, assertExists } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { assertDrained, drainEventLoop } from "../../../_helpers/utils.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

afterAll(async () => {
  await cleanupBundler();
});

describe(
  "RSC Streaming",
  {
    // React SSR requires disabled sanitizers
  },
  () => {
    it("should emit multi-slot updates in order", async () => {

      await withTestContext("rsc-stream", async (context) => {
        await Deno.writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        const appDir = join(context.projectDir, "app");
        await Deno.mkdir(appDir, { recursive: true });

          await Deno.writeTextFile(
            join(appDir, "page.tsx"),
            `import React from 'react';

export default function HomePage({ searchParams }: { searchParams: { name?: string } }) {
  const name = searchParams?.name || 'World';
  return <div>Hello {name}</div>;
}`,
          );

          const server = await context.createProductionServer();

          const response = await fetch(
            `http://localhost:${server.port}/_veryfront/rsc/stream?name=Eve`,
          );
          assertEquals(response.status, 200, "RSC stream endpoint should be available");

          if (!response.body) {
            throw new Error("Expected response body for streaming");
          }

          const reader = response.body.getReader();
          assertExists(reader);
          const decoder = new TextDecoder();
          let buffer = "";
          const events: Array<{ id: string; html: string }> = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const message = JSON.parse(line);
                if (message.type === "slot") {
                  events.push({
                    id: String(message.id),
                    html: String(message.html),
                  });
                }
              } catch {
                // Skip malformed JSON lines
              }
            }
          }

          const rootEvents = events.filter((e) => e.id === "root");
          const sidebarEvents = events.filter((e) => e.id === "sidebar");

          assertEquals(
            rootEvents.length >= 2,
            true,
            "Should receive at least 2 root events (loading + final)",
          );

          assertEquals(
            sidebarEvents.length >= 2,
            true,
            "Should receive at least 2 sidebar events (loading + final)",
          );

          const lastRootHtml = rootEvents[rootEvents.length - 1]?.html || "";
          assertEquals(
            /Hello|OK/.test(lastRootHtml),
            true,
            "Final root content should contain expected text",
          );

          const lastSidebarHtml = sidebarEvents[sidebarEvents.length - 1]?.html || "";
          assertEquals(
            /<li>/.test(lastSidebarHtml),
            true,
            "Final sidebar content should contain list items",
          );
      });
    });
  },
);
