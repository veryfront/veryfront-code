import process from "node:process";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractWithNativeProcessNode } from "../../../../../../extensions/ext-document-kreuzberg/src/node-native-extraction.ts";

const executables = await Promise.all(["node", "bun"].map(async (execPath) => ({
  execPath,
  available: await new Deno.Command(execPath, {
    args: ["--version"],
    stdout: "null",
    stderr: "null",
  }).output().then((result) => result.success, () => false),
})));
describe("Node and Bun native extraction process cancellation", () => {
  for (const { execPath, available } of executables) {
    it(
      `kills the actual ${execPath} child on abort and preserves reason`,
      { ignore: !available },
      async () => {
        const directory = await Deno.makeTempDir();
        const path = `${directory}/fixture.mjs`;
        await Deno.writeTextFile(
          path,
          `
        import process from "node:process";
        for await (const _chunk of process.stdin) {}
        process.stdout.write(JSON.stringify({type:"progress",event:{unit:"file",current:process.pid}})+"\\n");
        setInterval(() => {},1000);
      `,
        );
        const controller = new AbortController();
        const reason = { kind: "test cancellation" };
        let childPid: number | undefined;
        try {
          let rejected: unknown;
          try {
            await extractWithNativeProcessNode(
              new ArrayBuffer(0),
              "text/html",
              {
                signal: controller.signal,
                hardTimeoutMs: 10000,
                onProgress: (event) => {
                  childPid = event.current;
                  controller.abort(reason);
                  return new Promise<void>(() => {});
                },
              },
              "progress",
              { execPath, scriptUrl: new URL(`file://${path}`) },
            );
          } catch (error) {
            rejected = error;
          }
          assertEquals(rejected, reason);
          assertEquals(typeof childPid, "number");
          let alive = false;
          if (childPid !== undefined) {
            try {
              process.kill(childPid, 0);
              alive = true;
            } catch { /* exited */ }
          }
          assertEquals(alive, false);
        } finally {
          await Deno.remove(directory, { recursive: true });
        }
      },
    );
    for (
      const scenario of [
        "blocked callback",
        "duplicate done",
        "truncated protocol",
        "normal result",
        "large result",
      ]
    ) {
      it(
        `${execPath} settles ${scenario} with an actual child`,
        { ignore: !available },
        async () => {
          const directory = await Deno.makeTempDir();
          const path = `${directory}/fixture.mjs`;
          const output = scenario === "blocked callback"
            ? 'process.stdout.write(JSON.stringify({type:"progress",event:{unit:"file",current:1}})+"\\n");setInterval(()=>{},1000);'
            : scenario === "duplicate done"
            ? 'process.stdout.write(JSON.stringify({type:"done",content:"first"})+"\\n"+JSON.stringify({type:"done",content:"second"})+"\\n");'
            : scenario === "large result"
            ? 'process.stdout.write(JSON.stringify({type:"done",content:"x".repeat(16*1024*1024+1)+"END"})+"\\n");'
            : scenario === "truncated protocol"
            ? 'process.stdout.write("{broken");'
            : 'process.stdout.write(JSON.stringify({type:"done",content:"result"})+"\\n");';
          await Deno.writeTextFile(
            path,
            `import process from "node:process";for await(const _chunk of process.stdin){} ${output}`,
          );
          try {
            let result: string | undefined;
            let rejected: unknown;
            let callbackStarted = false;
            try {
              result = await extractWithNativeProcessNode(
                new ArrayBuffer(0),
                "text/html",
                {
                  hardTimeoutMs: 10000,
                  onProgress: () => {
                    callbackStarted = true;
                    return new Promise<void>(() => {});
                  },
                },
                "progress",
                { execPath, scriptUrl: new URL(`file://${path}`) },
              );
            } catch (error) {
              rejected = error;
            }
            if (scenario === "large result") {
              assertEquals(rejected, undefined);
              assertEquals(result?.length, 16 * 1024 * 1024 + 4);
              assertEquals(result?.endsWith("END"), true);
              assertEquals(
                result?.slice(0, 16 * 1024 * 1024 + 1),
                "x".repeat(16 * 1024 * 1024 + 1),
              );
            } else if (scenario === "normal result") {
              assertEquals(result, "result");
              assertEquals(rejected, undefined);
            } else {
              assertEquals(rejected instanceof Error, true);
              if (scenario === "blocked callback") assertEquals(callbackStarted, true);
            }
          } finally {
            await Deno.remove(directory, { recursive: true });
          }
        },
      );
    }
    it(`contains an actual ${execPath} child crash`, { ignore: !available }, async () => {
      const directory = await Deno.makeTempDir();
      const path = `${directory}/fixture.mjs`;
      await Deno.writeTextFile(
        path,
        `import process from "node:process"; for await (const _chunk of process.stdin) {} process.kill(process.pid,"SIGKILL");`,
      );
      try {
        let rejected: unknown;
        try {
          await extractWithNativeProcessNode(
            new ArrayBuffer(0),
            "text/html",
            { hardTimeoutMs: 10000 },
            "whole-file",
            { execPath, scriptUrl: new URL(`file://${path}`) },
          );
        } catch (error) {
          rejected = error;
        }
        assertEquals(rejected instanceof Error, true);
      } finally {
        await Deno.remove(directory, { recursive: true });
      }
    });
  }
});
