import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { fromFileUrl } from "#std/path";
import {
  deleteEnv,
  deleteHostSecret,
  env,
  getEnv,
  getHostEnv,
  getHostEnvExcludingEnvFile,
  registerTrustedProjectEnvSnapshot,
  setEnv,
  setHostSecret,
} from "./env.ts";
import { createProjectScopedDenoEnvView } from "./scoped-process-env.ts";

const denoOnlyIt = isDeno ? it : it.skip;

describe("host environment access", () => {
  it("hides a host-private credential from every project-reachable reader", () => {
    const key = "VF_HOST_SECRET_TEST_TOKEN";
    setHostSecret(key, "host-private-token");

    try {
      // Framework code reads it; project code — which reaches `getEnv()`, the
      // bulk environment, and `Deno.env` — does not.
      assertEquals(getHostEnv(key), "host-private-token");
      assertEquals(getEnv(key), undefined);
      assertEquals(env()[key], undefined);
      if (isDeno) assertEquals(Deno.env.get(key), undefined);
    } finally {
      deleteHostSecret(key);
    }

    assertEquals(getHostEnv(key), undefined);
  });

  it("lets an exported variable win over a host-private credential", () => {
    const key = "VF_HOST_SECRET_TEST_OVERRIDE";
    setHostSecret(key, "host-private-token");
    setEnv(key, "exported-token");

    try {
      assertEquals(getHostEnv(key), "exported-token");
      assertEquals(getEnv(key), "exported-token");
    } finally {
      deleteHostSecret(key);
      deleteEnv(key);
    }
  });

  it("keeps host API routing at the value paired with a registered login", () => {
    setEnv("VERYFRONT_API_URL", "https://trusted-api.example");
    setHostSecret("VERYFRONT_API_TOKEN", "host-private-token");
    setEnv("VERYFRONT_API_URL", "https://project-mutated.example");

    try {
      assertEquals(
        getHostEnvExcludingEnvFile("VERYFRONT_API_URL"),
        "https://trusted-api.example",
      );
    } finally {
      deleteHostSecret("VERYFRONT_API_TOKEN");
      deleteEnv("VERYFRONT_API_URL");
    }
  });

  it("does not let a blank exported variable strand a host-private credential", () => {
    const key = "VF_HOST_SECRET_TEST_BLANK";
    setHostSecret(key, "host-private-token");
    setEnv(key, "   ");

    try {
      // The CLI normalizes a blank `VERYFRONT_API_TOKEN` to "unset" before it
      // registers the stored login token, so a blank export must not be treated
      // as an authoritative value that hides the credential.
      assertEquals(getHostEnv(key), "host-private-token");
    } finally {
      deleteHostSecret(key);
      deleteEnv(key);
    }
  });

  it("classifies a blank export without a mutable String.prototype hook", () => {
    const key = "VF_HOST_SECRET_TEST_POISONED_TRIM";
    const originalTrim = Object.getOwnPropertyDescriptor(String.prototype, "trim")!;
    let poisonedCalls = 0;
    setHostSecret(key, "host-private-token");
    setEnv(key, "   ");
    Object.defineProperty(String.prototype, "trim", {
      configurable: true,
      value: () => {
        poisonedCalls += 1;
        throw new Error("blank-value classification must not run a project hook");
      },
    });

    try {
      // `getHostEnv` is on the credential path, so a project that replaces
      // `String.prototype.trim` must neither observe the read nor steer which
      // value wins.
      assertEquals(getHostEnv(key), "host-private-token");
    } finally {
      Object.defineProperty(String.prototype, "trim", originalTrim);
      deleteHostSecret(key);
      deleteEnv(key);
    }

    assertEquals(poisonedCalls, 0);
  });

  it("reports a blank exported variable verbatim when no credential is registered", () => {
    const key = "VF_HOST_SECRET_TEST_BLANK_ONLY";
    setEnv(key, "");

    try {
      assertEquals(getHostEnv(key), "");
    } finally {
      deleteEnv(key);
    }
  });

  it("creates an immutable scoped Deno environment facade", () => {
    const view = createProjectScopedDenoEnvView({
      get: () => undefined,
      set: () => {},
      delete: () => {},
      has: () => false,
      toObject: () => ({}),
    }, () => undefined);

    assertEquals(Object.isFrozen(view), true);
    for (const method of ["get", "set", "delete", "has", "toObject"] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(view, method);
      assertEquals(descriptor?.writable, false);
      assertEquals(descriptor?.configurable, false);
    }
    assertThrows(() => Object.defineProperty(view, "get", { value: () => "intercepted" }));
  });

  denoOnlyIt("passes only the active project environment to direct subprocesses", async () => {
    const hostKey = "VF_SCOPE_SUBPROCESS_HOST_ONLY";
    const projectKey = "VF_SCOPE_SUBPROCESS_PROJECT_ONLY";
    const previousHost = Deno.env.get(hostKey);
    Deno.env.set(hostKey, "host-secret");
    let snapshot: Readonly<Record<string, string>> | undefined;
    registerTrustedProjectEnvSnapshot(() => snapshot);
    snapshot = { [projectKey]: "project-value" };

    try {
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "eval",
          `console.log(JSON.stringify({ host: Deno.env.get(${
            JSON.stringify(hostKey)
          }) ?? null, project: Deno.env.get(${JSON.stringify(projectKey)}) ?? null }))`,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(output.success, new TextDecoder().decode(output.stderr));
      assertEquals(
        JSON.parse(new TextDecoder().decode(output.stdout).trim()),
        { host: null, project: "project-value" },
      );
    } finally {
      snapshot = undefined;
      if (previousHost === undefined) Deno.env.delete(hostKey);
      else Deno.env.set(hostKey, previousHost);
    }
  });

  denoOnlyIt("loads the testing overlay after the project environment facade", async () => {
    const storageUrl = new URL("../../../server/project-env/storage.ts", import.meta.url).href;
    const bddUrl = new URL("../../../testing/bdd.ts", import.meta.url).href;
    const source = `
      const { runWithProjectEnv } = await import(${JSON.stringify(storageUrl)});
      await import(${JSON.stringify(bddUrl)});
      Deno.env.set("VF_LATE_TEST_ROOT", "root-value");
      const scoped = runWithProjectEnv({ VF_LATE_TEST_PROJECT: "project-value" }, () => ({
        root: Deno.env.get("VF_LATE_TEST_ROOT") ?? null,
        project: Deno.env.get("VF_LATE_TEST_PROJECT") ?? null,
        processRoot: process.env.VF_LATE_TEST_ROOT ?? null,
        processProject: process.env.VF_LATE_TEST_PROJECT ?? null,
      }));
      console.log(JSON.stringify({
        root: Deno.env.get("VF_LATE_TEST_ROOT") ?? null,
        processRoot: process.env.VF_LATE_TEST_ROOT ?? null,
        scoped,
      }));
    `;
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-env",
        `--allow-read=${fromFileUrl(new URL("../../../../", import.meta.url))}`,
        "-",
      ],
      clearEnv: true,
      env: { DENO_TESTING: "1" },
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
      {
        root: "root-value",
        processRoot: "root-value",
        scoped: {
          root: null,
          project: "project-value",
          processRoot: null,
          processProject: "project-value",
        },
      },
    );
  });

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
