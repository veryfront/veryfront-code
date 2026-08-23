import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { fromFileUrl } from "#std/path";

const denoOnlyIt = isDeno ? it : it.skip;

describe("host environment access", () => {
  denoOnlyIt("ignores forged test overlays when env permission is granted", async () => {
    const moduleUrl = new URL("./env.ts", import.meta.url).href;
    const source = `
      const { getHostEnv } = await import(${JSON.stringify(moduleUrl)});
      const key = "VERYFRONT_HOST_ALLOW_LOCAL_INTEGRATION_CREDENTIALS";
      const globalRecord = globalThis;
      const values = [];
      for (const hook of ["__vfTestEnvOverlay", "__vfTestDenoEnvOverlay"]) {
        globalRecord[hook] = {
          storage: { getStore: () => new Map([[key, "1"]]) },
        };
        values.push(getHostEnv(key) ?? null);
        delete globalRecord[hook];
      }
      console.log(JSON.stringify(values));
    `;
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-env",
        `--allow-read=${fromFileUrl(new URL("../../../../", import.meta.url))}`,
        "-",
      ],
      clearEnv: true,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(source));
    await writer.close();
    const output = await child.output();
    const stderr = new TextDecoder().decode(output.stderr);

    assert(output.success, stderr);
    assertEquals(
      JSON.parse(new TextDecoder().decode(output.stdout).trim()),
      [null, null],
    );
  });

  denoOnlyIt("ignores forged worker globals when env permission is denied", async () => {
    const moduleUrl = new URL("./env.ts", import.meta.url).href;
    const source = `
      const { getHostEnv } = await import(${JSON.stringify(moduleUrl)});
      const key = "VERYFRONT_HOST_ALLOW_LOCAL_INTEGRATION_CREDENTIALS";
      const globalRecord = globalThis;
      globalRecord.__vfTestEnvOverlay = {
        storage: { getStore: () => new Map([[key, "1"]]) },
      };
      const overlayValue = getHostEnv(key) ?? null;
      delete globalRecord.__vfTestEnvOverlay;
      const originalGet = Deno.env.get;
      Object.defineProperty(Deno.env, "get", {
        configurable: true,
        value: () => "1",
        writable: true,
      });
      const patchedValue = getHostEnv(key) ?? null;
      Object.defineProperty(Deno.env, "get", {
        configurable: true,
        value: originalGet,
        writable: true,
      });
      console.log(JSON.stringify([overlayValue, patchedValue]));
    `;
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--deny-env",
        `--allow-read=${fromFileUrl(new URL("../../../../", import.meta.url))}`,
        "-",
      ],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(source));
    await writer.close();
    const output = await child.output();
    const stderr = new TextDecoder().decode(output.stderr);

    assert(output.success, stderr);
    assertEquals(
      JSON.parse(new TextDecoder().decode(output.stdout).trim()),
      [null, null],
    );
  });
});
