import { assertEquals, assertRejects } from "#std/assert";
import { patchDntArgvPolyfill } from "./dnt-polyfill.ts";

Deno.test("patchDntArgvPolyfill guards missing process argv entries", async () => {
  const directory = await Deno.makeTempDir();
  const path = `${directory}/_dnt.polyfills.js`;

  try {
    await Deno.writeTextFile(
      path,
      'const mainUrl = "file:///" + process.argv[1].replace(/\\\\/g, "/");\n',
    );

    assertEquals(await patchDntArgvPolyfill(path, { required: true }), true);
    assertEquals(
      await Deno.readTextFile(path),
      'const mainUrl = "file:///" + (process.argv[1] ?? "").replace(/\\\\/g, "/");\n',
    );
    assertEquals(await patchDntArgvPolyfill(path, { required: true }), false);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("patchDntArgvPolyfill skips packages without the DNT import-meta shim", async () => {
  const directory = await Deno.makeTempDir();
  const path = `${directory}/_dnt.polyfills.js`;

  try {
    await Deno.writeTextFile(path, "export {};\n");
    assertEquals(await patchDntArgvPolyfill(path), false);
    assertEquals(await Deno.readTextFile(path), "export {};\n");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("patchDntArgvPolyfill fails closed when required DNT output changes", async () => {
  const directory = await Deno.makeTempDir();
  const path = `${directory}/_dnt.polyfills.js`;

  try {
    await Deno.writeTextFile(path, "export {};\n");
    await assertRejects(
      () => patchDntArgvPolyfill(path, { required: true }),
      Error,
      "does not contain the expected process.argv[1] expression",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
