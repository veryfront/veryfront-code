import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { getEnv, getHostEnv } from "#veryfront/platform/compat/process.ts";

// Import storage to register the private project-env snapshot bridge.
import { runWithProjectEnv } from "./storage.ts";

describe("getEnv with project env overlay", () => {
  it("shares late snapshot registration across direct and barrel import paths", async () => {
    const storageUrl = new URL("./storage.ts", import.meta.url).href;
    const envUrl = new URL(
      "../../platform/compat/process/env.ts",
      import.meta.url,
    ).href;
    const processBarrelUrl = new URL(
      "../../platform/compat/process.ts",
      import.meta.url,
    ).href;
    const source = [
      `const directEnv = await import(${JSON.stringify(envUrl)});`,
      `const processBarrel = await import(${JSON.stringify(processBarrelUrl)});`,
      `const key = "__VF_LATE_PROJECT_ENV_REGISTRATION__";`,
      `Deno.env.set(key, "host");`,
      `try {`,
      `  const before = [directEnv.getEnv(key), processBarrel.getEnv(key)];`,
      `  const storage = await import(${JSON.stringify(storageUrl)});`,
      `  const project = storage.runWithProjectEnv({ [key]: "project" }, () => [`,
      `    directEnv.getEnv(key),`,
      `    processBarrel.getEnv(key),`,
      `    directEnv.getTrustedProjectEnvSnapshot()?.[key],`,
      `  ]);`,
      `  const empty = storage.runWithProjectEnv({}, () => [`,
      `    directEnv.getEnv(key),`,
      `    processBarrel.getEnv(key),`,
      `  ]);`,
      `  console.log(JSON.stringify({`,
      `    sameGetter: directEnv.getEnv === processBarrel.getEnv,`,
      `    before,`,
      `    project,`,
      `    empty,`,
      `    after: [directEnv.getEnv(key), processBarrel.getEnv(key)],`,
      `  }));`,
      `} finally {`,
      `  Deno.env.delete(key);`,
      `}`,
    ].join("\n");
    const command = new Deno.Command(Deno.execPath(), {
      args: ["eval", "--frozen", "--config=deno.json", source],
      stdout: "piped",
      stderr: "piped",
    });

    const output = await command.output();
    assertEquals(
      output.success,
      true,
      new TextDecoder().decode(output.stderr),
    );
    assertEquals(
      JSON.parse(new TextDecoder().decode(output.stdout)),
      {
        sameGetter: true,
        before: ["host", "host"],
        project: ["project", "project", "project"],
        empty: [null, null],
        after: ["host", "host"],
      },
    );
  });

  it("does not trust replaceable legacy global hooks for project isolation", async () => {
    const storageUrl = new URL("./storage.ts", import.meta.url).href;
    const envUrl = new URL(
      "../../platform/compat/process/env.ts",
      import.meta.url,
    ).href;
    const source = [
      `import { runWithProjectEnv } from ${JSON.stringify(storageUrl)};`,
      `import { getEnv } from ${JSON.stringify(envUrl)};`,
      `const key = "__VF_LEGACY_ENV_BRIDGE_SECRET__";`,
      `Deno.env.set(key, "host-secret");`,
      `globalThis.__vfProjectEnvGetter = () => undefined;`,
      `globalThis.__vfProjectEnvActiveChecker = () => false;`,
      `try {`,
      `  console.log(runWithProjectEnv({}, () => getEnv(key)) ?? "<undefined>");`,
      `} finally {`,
      `  Deno.env.delete(key);`,
      `}`,
    ].join("\n");
    const command = new Deno.Command(Deno.execPath(), {
      args: ["eval", "--frozen", "--config=deno.json", source],
      stdout: "piped",
      stderr: "piped",
    });

    const output = await command.output();
    assertEquals(
      output.success,
      true,
      new TextDecoder().decode(output.stderr),
    );
    assertEquals(
      new TextDecoder().decode(output.stdout).trim(),
      "<undefined>",
    );
  });

  it("returns project env overlay when active", () => {
    runWithProjectEnv({ CUSTOM_VAR: "custom-value" }, () => {
      assertEquals(getEnv("CUSTOM_VAR"), "custom-value");
    });
  });

  it("keeps concurrent asynchronous getEnv reads isolated", async () => {
    const firstStarted = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    const first = runWithProjectEnv(
      { ASYNC_PROJECT_ENV: "first" },
      async () => {
        firstStarted.resolve();
        await releaseFirst.promise;
        return getEnv("ASYNC_PROJECT_ENV");
      },
    );

    await firstStarted.promise;
    const second = runWithProjectEnv(
      { ASYNC_PROJECT_ENV: "second" },
      async () => {
        await Promise.resolve();
        const value = getEnv("ASYNC_PROJECT_ENV");
        releaseFirst.resolve();
        return value;
      },
    );

    assertEquals(await Promise.all([first, second]), ["first", "second"]);
  });

  it("falls through to process env when no overlay", () => {
    // PATH is always set in process env
    const pathValue = getEnv("PATH");
    assertEquals(typeof pathValue, "string");
    assertEquals((pathValue?.length ?? 0) > 0, true);
  });

  it("blocks fallthrough to process env when overlay is active", () => {
    runWithProjectEnv({ SOME_KEY: "some-value" }, () => {
      // PATH exists in host env but must NOT leak into project scope
      assertEquals(getEnv("PATH"), undefined);
    });
  });

  it("overlay takes precedence over process env for matching keys", () => {
    // This test verifies overlay precedence without modifying process env
    runWithProjectEnv({ TEST_OVERLAY_KEY: "overlay-value" }, () => {
      assertEquals(getEnv("TEST_OVERLAY_KEY"), "overlay-value");
    });

    // Outside overlay, should not find the key (unless it happens to be in process env)
    // We just verify the overlay is gone
    assertEquals(getEnv("TEST_OVERLAY_KEY"), undefined);
  });

  it("empty overlay still blocks host env access", () => {
    runWithProjectEnv({}, () => {
      // Even with an empty overlay, host env must not leak
      assertEquals(getEnv("PATH"), undefined);
      assertEquals(getEnv("HOME"), undefined);
    });
    // Outside overlay, host env is accessible again
    assertEquals(typeof getEnv("PATH"), "string");
  });

  it("getHostEnv still reads host env when overlay is active", () => {
    runWithProjectEnv({}, () => {
      assertEquals(getEnv("PATH"), undefined);
      assertEquals(typeof getHostEnv("PATH"), "string");
      assertEquals((getHostEnv("PATH")?.length ?? 0) > 0, true);
    });
  });
});
