import { join } from "#veryfront/compat/path";
import { mkdir } from "#veryfront/platform/compat/fs.ts";
import {
  assertEquals,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withTestContext } from "../../../tests/_helpers/context.ts";
import { DevServer } from "./server.ts";

describe("DevServer handler-only transport context", () => {
  it("admits direct loopback chooser requests from Deno, Node, and Bun hosts", async () => {
    await withTestContext("dev-handler-only-peer", async (context) => {
      const workspace = join(context.projectDir, "workspace");
      await mkdir(join(workspace, "projects", "example", "app"), { recursive: true });
      const server = new DevServer({
        projectDir: workspace,
        port: await context.allocatePort(),
        enableHMR: false,
        handlerOnly: true,
      });
      await server.start();

      try {
        const contexts = [
          {
            remoteAddr: {
              transport: "tcp",
              hostname: "127.0.0.1",
              port: 52_000,
            },
          },
          {
            requestIP(request: Request) {
              assertEquals(request.url, "http://localhost/");
              return { address: "127.0.0.1", family: "IPv4", port: 52_001 };
            },
          },
          {
            socket: { remoteAddress: "127.0.0.1" },
          },
        ];

        for (const nativeContext of contexts) {
          const response = await server.handler(
            new Request("http://localhost/", { headers: { host: "localhost" } }),
            nativeContext,
          );
          assertEquals(response.status, 200);
          assertStringIncludes(await response.text(), "<!DOCTYPE html>");
        }
      } finally {
        await server.stop();
      }
    });
  });

  it("records native peer context before request interceptors replace the request", async () => {
    await withTestContext("dev-handler-only-interceptor-peer", async (context) => {
      const workspace = join(context.projectDir, "workspace");
      await mkdir(join(workspace, "projects", "example", "app"), { recursive: true });
      const server = new DevServer({
        projectDir: workspace,
        port: await context.allocatePort(),
        enableHMR: false,
        handlerOnly: true,
        defaultProjectSlug: "example",
        defaultProjectId: context.projectId,
        requestInterceptor: (request) => new Request(request),
      });
      await server.start();

      const createRequest = () =>
        new Request("http://localhost/_metrics", {
          headers: { host: "localhost" },
        });

      try {
        const denoLoopback = await server.handler(createRequest(), {
          remoteAddr: {
            transport: "tcp",
            hostname: "127.0.0.1",
            port: 52_002,
          },
        });
        assertEquals(denoLoopback.status, 200);
        await denoLoopback.body?.cancel();

        const denoRemote = await server.handler(createRequest(), {
          remoteAddr: {
            transport: "tcp",
            hostname: "192.168.1.25",
            port: 52_003,
          },
        });
        await denoRemote.body?.cancel();
        assertEquals(denoRemote.status, 403);

        const bunRequest = createRequest();
        const bunLoopback = await server.handler(bunRequest, {
          requestIP(seenRequest: Request) {
            assertStrictEquals(seenRequest, bunRequest);
            return { address: "::1", family: "IPv6", port: 52_004 };
          },
        });
        assertEquals(bunLoopback.status, 200);
        await bunLoopback.body?.cancel();
      } finally {
        await server.stop();
      }
    });
  });
});
