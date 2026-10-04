import { assert, assertEquals } from "#veryfront/testing/assert";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { fileURLToPath } from "node:url";

const root = new URL("../../../../", import.meta.url);
const fixture = new URL("fixtures/runs-cli.ts", import.meta.url);

async function cli(scenario: string, config?: unknown) {
  const dir = await makeTempDir({ prefix: "vf-runs-cli-" });
  try {
    await Deno.writeTextFile(`${dir}/credential`, "scoped-test-token\n");
    if (scenario.startsWith("login-")) {
      await Deno.mkdir(`${dir}/config/veryfront`, { recursive: true });
      await Deno.writeTextFile(`${dir}/config/veryfront/token`, "scoped-test-token\n");
    }
    await Deno.writeTextFile(
      `${dir}/veryfront.config.ts`,
      'throw new Error("Project modules must not execute");',
    );
    if (config) await Deno.writeTextFile(`${dir}/veryfront.json`, JSON.stringify(config));
    const coverageDir = Deno.env.get("VF_RUNS_CLI_COVERAGE_DIR");
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        ...(coverageDir ? [`--coverage=${coverageDir}`] : []),
        "--frozen",
        "--allow-all",
        fixture.href,
        dir,
        scenario,
      ],
      cwd: fileURLToPath(root),
      env: {
        VERYFRONT_API_URL: config ? "" : "https://api.example.test",
        VERYFRONT_API_BASE_URL: "",
        VERYFRONT_API_TOKEN: "",
        VF_DISABLE_LRU_INTERVAL: "1",
        XDG_CONFIG_HOME: `${dir}/config`,
        VERYFRONT_PROJECT_SLUG: "",
        VERYFRONT_PROJECT_ID: "",
        TENANT_PROJECT_SLUG: "",
        TENANT_PROJECT_ID: "",
      },
      stdout: "piped",
      stderr: "piped",
    });
    if (scenario === "ndjson-error-blocked") {
      const child = command.spawn();
      const reader = child.stdout.getReader({ mode: "byob" });
      const stderrReader = child.stderr.getReader();
      let ready = false;
      const readiness = (async () => {
        let text = "";
        while (!text.includes("ndjson-error-ready")) {
          const { value, done } = await stderrReader.read();
          assert(!done, "Expected the iterator failure marker.");
          text += new TextDecoder().decode(value);
        }
        ready = true;
      })();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let stopped = false;
      try {
        let prefix = "";
        // Small reads leave less than one error envelope of free pipe space
        // while the stderr marker travels, including under coverage instrumentation.
        while (!ready) {
          const { value, done } = await reader.read(new Uint8Array(256));
          assert(!done, "Expected partial error output before interruption.");
          prefix = new TextDecoder().decode(value);
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        await readiness;
        // Let the handler reach its final error write, leaving stdout under backpressure.
        await new Promise((resolve) => setTimeout(resolve, 50));
        child.kill("SIGINT");
        const status = await Promise.race([
          child.status,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("Cancellation did not terminate")), 3000);
          }),
        ]);
        stopped = true;
        let stderr = "";
        while (true) {
          const { value, done } = await stderrReader.read();
          if (done) break;
          stderr += new TextDecoder().decode(value);
        }
        return { code: status.code, stdout: prefix, stderr };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (!stopped) child.kill("SIGKILL");
        await child.status;
        await reader.cancel();
        reader.releaseLock();
        await stderrReader.cancel();
        stderrReader.releaseLock();
      }
    }
    if (scenario === "ndjson-output-closed") {
      const child = command.spawn();
      const reader = child.stdout.getReader();
      try {
        await reader.read();
        await reader.cancel();
        const status = await child.status;
        const stderr = await new Response(child.stderr).text();
        return { code: status.code, stdout: "", stderr };
      } finally {
        reader.releaseLock();
      }
    }
    const result = await command.output();
    return {
      code: result.code,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

describe("project runs CLI output and host credentials", () => {
  it("dispatches through the existing project handler and emits JSON with a file credential and no login", async () => {
    const result = await cli("success");
    assertEquals(result.code, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assertEquals(envelope.success, true);
    assertEquals(envelope.command, "project runs");
    assertEquals(envelope.data.id, "11111111-1111-4111-8111-111111111111");
    assert(!result.stdout.includes("scoped-test-token"));
  });

  it("returns intentional event credentials and preserves user-owned success payloads", async () => {
    const token = await cli("event-token");
    assertEquals(token.code, 0, token.stderr);
    const credential = JSON.parse(token.stdout).data;
    assertEquals(credential.token, "example-token");
    assertEquals(credential.token_type, "Bearer");
    const result = await cli("business-output");
    assertEquals(result.code, 0, result.stderr);
    assertEquals(JSON.parse(result.stdout).data.output, {
      token_count: 2,
      credential_policy: "minimum-length",
    });
  });

  it("terminates malformed and network streams with one NDJSON error envelope", async () => {
    for (const scenario of ["stream-malformed", "stream-network"]) {
      const result = await cli(scenario);
      assertEquals(result.code, 1);
      const lines = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
      assertEquals(lines.at(-1).success, false);
      assertEquals(lines.at(-1).error.code, "RUNTIME_ERROR");
      if (scenario === "stream-malformed") assertEquals(lines[0].success, true);
      assertEquals(lines.filter((line) => line.success === false).length, 1);
    }
  });

  it("emits per-item NDJSON envelopes without --json and preserves partial output on errors", async () => {
    for (const scenario of ["ndjson", "ndjson-all", "ndjson-json"]) {
      const success = await cli(scenario);
      assertEquals(success.code, 0, success.stderr);
      const lines = success.stdout.trim().split("\n").map((line) => JSON.parse(line));
      assert(lines.length >= 2);
      assert(lines.every((line) => line.success && !Array.isArray(line.data)));
    }
    const failure = await cli("ndjson-error");
    assertEquals(failure.code, 1, failure.stderr);
    const partial = failure.stdout.trim().split("\n").map((line) => JSON.parse(line));
    assertEquals(partial[0].success, true);
    assertEquals(partial.at(-1).success, false);
    assertEquals(partial.at(-1).error.code, "FORBIDDEN");
  });

  it("interrupts a blocked final NDJSON error envelope with exit 130", async () => {
    const result = await cli("ndjson-error-blocked");
    assertEquals(result.code, 130, result.stderr);
  });

  it("emits an NDJSON usage error without --json when invocation parsing fails", async () => {
    const result = await cli("ndjson-invalid");
    assertEquals(result.code, 2, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assertEquals(envelope.success, false);
    assertEquals(envelope.error.slug, "invalid-arguments");
  });

  it("terminates with exit 1 when the stdout consumer closes", async () => {
    const result = await cli("ndjson-output-closed");
    assertEquals(result.code, 1);
    assert(result.stderr.includes("Could not write NDJSON output."));
  });

  it("uses the stored login for account-scoped operations without a local project reference", async () => {
    for (const scenario of ["login-list", "login-analytics", "login-get"]) {
      const result = await cli(scenario);
      assertEquals(result.code, 0, result.stderr);
      assertEquals(JSON.parse(result.stdout).success, true);
    }
  });

  it("selects API-key auth on the canonical host transport", async () => {
    const result = await cli("api-key");
    assertEquals(result.code, 0, result.stderr);
    assertEquals(JSON.parse(result.stdout).success, true);
  });

  it("emits one JSON envelope per stream frame without human output", async () => {
    const result = await cli("stream");
    assertEquals(result.code, 0, result.stderr);
    const lines = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
    assert(lines.length > 0);
    assert(lines.every((line) => line.success === true && line.command === "project runs"));
    assertEquals(lines[0].data.id, "42");
  });

  it("preserves Problem codes and maps validation and authorization failures to actual process exits", async () => {
    for (
      const [scenario, exitCode, problemCode] of [["validation", 2, "INVALID_REQUEST"], [
        "forbidden",
        1,
        "FORBIDDEN",
      ]] as const
    ) {
      const result = await cli(scenario);
      assertEquals(result.code, exitCode, result.stderr);
      const envelope = JSON.parse(result.stdout);
      assertEquals(envelope.success, false);
      assertEquals(envelope.error.code, problemCode);
      assertEquals(envelope.error.slug, exitCode === 2 ? "invalid-arguments" : "command-failed");
      assert(!result.stdout.includes("scoped-test-token"));
    }
  });

  it("refuses to send a file credential to an endpoint supplied by the repository", async () => {
    const result = await cli("success", {
      apiUrl: "https://untrusted.example.test",
      apiToken: "repository-token",
    });
    assertEquals(result.code, 1);
    assert(result.stderr.includes("Set the API endpoint explicitly"));
    assert(!result.stderr.includes("scoped-test-token"));
  });
});
