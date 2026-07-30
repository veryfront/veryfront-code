import { assertEquals } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { mkdir, writeTextFile } from "#veryfront/compat/fs.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe("RSC Streaming Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  // Clean up renderer intervals to prevent resource leaks
  afterAll(async () => {
    await cleanupBundler();
  });

  describe("RSC Streaming", {}, () => {
    it("streams the rendered project root without fabricated slots", async () => {
      await withTestContext("rsc-stream", async (context) => {
        await writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { experimental: { rsc: true } };`,
        );

        const appDir = join(context.projectDir, "app");
        await mkdir(appDir, { recursive: true });

        await writeTextFile(
          join(appDir, "page.tsx"),
          `import React from 'react';

export default function HomePage({ searchParams }: { searchParams: { name?: string } }) {
  const name = searchParams?.name || 'World';
  return <div>Hello {name}</div>;
}`,
        );

        const server = await context.createProductionServer();

        const response = await fetch(
          `http://127.0.0.1:${server.port}/_veryfront/rsc/stream?name=Eve`,
        );
        assertEquals(response.status, 200, "RSC stream endpoint should be available");

        const body = response.body;
        if (!body) throw new Error("Expected response body for streaming");

        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const events: Array<{ id: string; html: string }> = [];

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.trim()) continue;

              try {
                const message = JSON.parse(line);
                if (message.type !== "slot") continue;

                events.push({
                  id: String(message.id),
                  html: String(message.html),
                });
              } catch {
                // Skip malformed JSON lines
              }
            }
          }
        } finally {
          try {
            await reader.cancel();
          } catch {
            // ignore stream cancellation errors
          }
        }

        assertEquals(events.length, 1);
        assertEquals(events[0]?.id, "root");
        assertEquals(events[0]?.html.includes("Hello"), true);
        assertEquals(events[0]?.html.includes("Eve"), true);
      });
    });
  });
});
