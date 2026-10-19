import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";

it("cold imports renewable credentials on an edge host without filesystem support", async () => {
  const moduleUrl = new URL("../../../src/platform/cloud/credential-file.ts", import.meta.url).href;
  const script = `
    Reflect.deleteProperty(globalThis, "Deno");
    Reflect.deleteProperty(globalThis, "process");
    const module = await import(${JSON.stringify(moduleUrl)});
    if (module.readVeryfrontApiTokenFile(undefined) !== undefined) throw Error("No selector must be inert");
    let denied = false;
    try { module.readVeryfrontApiTokenFile("/unavailable/token"); } catch { denied = true; }
    if (!denied) throw Error("Configured file must fail closed on an edge host");
  `;
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["eval", "--config=deno.json", script],
    cwd: new URL("../../../", import.meta.url),
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
});

it("reads and rotates credential files on Deno without Node process", async () => {
  const moduleUrl = new URL("../../../src/platform/cloud/credential-file.ts", import.meta.url).href;
  const script = `
    const path = Deno.makeTempFileSync();
    try {
      Deno.writeTextFileSync(path, "first-token\\n");
      Reflect.deleteProperty(globalThis, "process");
      const module = await import(${JSON.stringify(moduleUrl)});
      if (module.readVeryfrontApiTokenFile(path) !== "first-token") throw Error("Deno file read failed");
      Deno.writeTextFileSync(path, "second-token");
      if (module.readVeryfrontApiTokenFile(path) !== "second-token") throw Error("Deno rotation failed");
      Deno.writeTextFileSync(path, "");
      let denied = false;
      try { module.readVeryfrontApiTokenFile(path); } catch { denied = true; }
      if (!denied) throw Error("Empty credential must fail closed");
    } finally { Deno.removeSync(path); }
  `;
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["eval", "--config=deno.json", script],
    cwd: new URL("../../../", import.meta.url),
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
});
