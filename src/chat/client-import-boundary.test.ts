import { assert } from "#std/assert";

const browserReachableModules = [
  {
    path: new URL("../agent/streaming/tool-input.ts", import.meta.url),
    required: ["#veryfront/utils/logger/logger.ts"],
  },
  {
    path: new URL("../utils/logger/logger.ts", import.meta.url),
    required: [
      "#veryfront/platform/compat/process/env.ts",
      "#veryfront/platform/compat/process/lifecycle.ts",
    ],
  },
  {
    path: new URL("../utils/version.ts", import.meta.url),
    required: ["#veryfront/platform/compat/process/env.ts"],
  },
];

Deno.test("chat client modules use leaf imports for server-capable dependencies", async () => {
  for (const { path, required } of browserReachableModules) {
    const source = await Deno.readTextFile(path);
    assert(
      !source.includes("#veryfront/platform/compat/process.ts") &&
        !source.includes('from "#veryfront/utils"'),
      `${path.pathname} must not pull a server-capable barrel into the chat browser graph`,
    );
    for (const specifier of required) {
      assert(source.includes(specifier), `${path.pathname} must import ${specifier}`);
    }
  }
});
