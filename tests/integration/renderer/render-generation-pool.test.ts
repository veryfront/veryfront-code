import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RenderGeneration } from "#veryfront/rendering/render-generation.ts";
import { RenderGenerationPool } from "#veryfront/rendering/render-generation-pool.ts";
import {
  type PreparedRenderArtifacts,
  RenderArtifacts,
} from "#veryfront/transforms/esm/render-artifacts.ts";
import { runtime } from "#veryfront/platform/adapters/registry.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { execPath, runCommand } from "#veryfront/platform/compat/process.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { fromFileUrl } from "#veryfront/compat/path";
import { jsonForInlineScript } from "#veryfront/security/client/html-sanitizer.ts";

describe("render generation pool process ownership", () => {
  it("replaces one replica's generation while another replica finishes the old release", async () => {
    const fs = createFileSystem();
    const adapter = await runtime.get();
    const first = new RenderGenerationPool({ maxGenerations: 2, maxConcurrentRenders: 3 });
    const second = new RenderGenerationPool({ maxGenerations: 1, maxConcurrentRenders: 1 });
    const instances = new Map<string, {
      gate: ReturnType<typeof Promise.withResolvers<void>>;
      ready: ReturnType<typeof Promise.withResolvers<number>>;
      prepared?: PreparedRenderArtifacts;
      exited: boolean;
    }>();
    const coordinator = await adapter.serve(async (request) => {
      const [, name, operation] = new URL(request.url).pathname.split("/");
      const instance = instances.get(name!);
      if (!instance) return new Response(null, { status: 404 });
      if (operation === "ready") instance.ready.resolve(Number(await request.text()));
      else if (operation === "continue") await instance.gate.promise;
      else return new Response(null, { status: 404 });
      return new Response(null, { status: 204 });
    }, { hostname: "127.0.0.1", port: 0 });
    const responses: Response[] = [];
    const request = () => new Request("http://localhost/page");
    const oldIdentity = { scopeId: "project", generationId: "old" };
    const newIdentity = { scopeId: "project", generationId: "new" };

    // Each factory constructs an owner without starting IO. Its first admitted
    // render performs publication and process startup under pool capacity.
    const factory = (name: string, value: string) => () => {
      const artifacts = new RenderArtifacts({
        files: [
          {
            path: "entry.mjs",
            source: 'export const load = async () => (await import("./child.mjs")).value;',
          },
          { path: "child.mjs", source: `export const value = ${jsonForInlineScript(value)};` },
        ],
        entrypoints: ["entry.mjs"],
      }, { maxEntries: 4, maxBytes: 4096 });
      const instance = {
        gate: Promise.withResolvers<void>(),
        ready: Promise.withResolvers<number>(),
        prepared: undefined as PreparedRenderArtifacts | undefined,
        exited: false,
      };
      instances.set(name, instance);
      const stop = new AbortController();
      let processResult: ReturnType<typeof runCommand> | undefined;
      let starting: Promise<number> | undefined;
      const start = () =>
        starting ??= (async () => {
          instance.prepared = await artifacts.prepare();
          stop.signal.throwIfAborted();
          const fixture = fromFileUrl(
            new URL("./fixtures/generation-executor.mjs", import.meta.url),
          );
          processResult = runCommand(execPath(), {
            args: [
              ...(isDeno ? ["run", "--no-config", "--allow-read", "--allow-net=127.0.0.1"] : []),
              fixture,
              instance.prepared.entrypointUrls[0]!,
              `http://127.0.0.1:${coordinator.addr.port}/${name}`,
            ],
            clearEnv: true,
            capture: true,
            signal: stop.signal,
            timeoutMs: 30_000,
            maxOutputBytes: 4096,
            terminateProcessTreeOnExit: true,
          }).then((result) => {
            instance.exited = true;
            return result;
          });
          return await Promise.race([
            instance.ready.promise,
            processResult.then(() => {
              throw new Error("Fixture exited before readiness");
            }),
          ]);
        })();
      return new RenderGeneration({
        maxConcurrentRenders: 1,
        drainTimeoutMs: 10_000,
        executor: {
          render: async (request) =>
            fetch(`http://127.0.0.1:${await start()}/page`, { signal: request.signal }),
          stop: async () => {
            stop.abort();
            await starting?.catch(() => {});
            await processResult;
          },
        },
        releaseArtifacts: async () => {
          assertEquals(
            !processResult || instance.exited,
            true,
            "executor exit must precede artifact deletion",
          );
          await artifacts.release();
        },
      });
    };

    try {
      const oldFirst = await first.render(request(), oldIdentity, factory("first-old", "old"));
      responses.push(oldFirst);
      const oldSecond = await second.render(request(), oldIdentity, factory("second-old", "old"));
      responses.push(oldSecond);
      const oldFirstState = instances.get("first-old")!;
      const oldSecondState = instances.get("second-old")!;
      assertEquals(oldFirstState.prepared!.id, oldSecondState.prepared!.id);
      assertEquals(oldFirstState.prepared!.directory === oldSecondState.prepared!.directory, false);

      const next = await first.render(request(), newIdentity, factory("first-new", "new"));
      responses.push(next);
      const retiring = first.retire(oldIdentity);
      await assertRejects(
        () =>
          first.render(request(), { scopeId: "project", generationId: "third" }, () => {
            throw new Error("Retiring owners must keep their capacity reservation");
          }),
        Error,
        "generation capacity",
      );
      assertEquals(await fs.exists(oldFirstState.prepared!.directory), true);

      oldFirstState.gate.resolve();
      assertEquals(await oldFirst.text(), "<main>old</main>");
      await retiring;
      assertEquals(oldFirstState.exited, true);
      assertEquals(await fs.exists(oldFirstState.prepared!.directory), false);
      assertEquals(oldSecondState.exited, false);
      assertEquals(await fs.exists(oldSecondState.prepared!.directory), true);

      instances.get("first-new")!.gate.resolve();
      assertEquals(await next.text(), "<main>new</main>");
      oldSecondState.gate.resolve();
      assertEquals(
        await oldSecond.text(),
        "<main>old</main>",
        "another replica retains its old lazy dependency",
      );
    } finally {
      for (const instance of instances.values()) instance.gate.resolve();
      await Promise.allSettled(
        responses.filter((response) => !response.bodyUsed).map((response) =>
          response.body?.cancel()
        ),
      );
      try {
        await Promise.all([first.close(), second.close()]);
        for (const instance of instances.values()) {
          assertEquals(instance.exited, true);
          assertEquals(await fs.exists(instance.prepared!.directory), false);
        }
      } finally {
        await coordinator.stop();
      }
    }
  });
});
