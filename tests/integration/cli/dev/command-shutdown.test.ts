import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  LOOPBACK_TEST_PERMISSIONS,
  PROVIDER_EGRESS_DENY_NET,
} from "../../../../scripts/test/suites.ts";
import { it } from "#veryfront/testing/bdd.ts";

it("settles startup integration discovery before dev command stop and done complete", async () => {
  await withTempDir(async (directory) => {
    const moduleUrl = (path: string) =>
      JSON.stringify(new URL(`../../../../${path}`, import.meta.url).href);
    // CLI services own process-lifetime state. Exercise the real command in an isolated child,
    // as in proxy-mode.test.ts, and register assertions after startup resources are stopped.
    const script = `
      import ${moduleUrl("src/schemas/_test-setup.ts")};
      import { devCommand } from ${moduleUrl("cli/commands/dev/command.ts")};
      import { withTestContext } from ${moduleUrl("tests/_helpers/context.ts")};
      import { withMockFetch } from ${moduleUrl("src/testing/mock-fetch.ts")};
      import { assertEquals } from ${moduleUrl("src/testing/assert.ts")};
      import { setEnv, deleteEnv } from "#cli/process-env";
      import { refreshEnvironmentConfig } from "#cli/environment-config";
      import { __subscribeLogRecordEmitter, setLogLevel, LogLevel } from ${
      moduleUrl("src/utils/logger/logger.ts")
    };
      const diagnosticLogs = [];
      const unsubscribe = __subscribeLogRecordEmitter((entry) => {
        if (/integration/i.test(entry.message)) diagnosticLogs.push(entry.message);
      });
      setLogLevel(LogLevel.DEBUG);
      const printed = [];
      const originalLog = console.log;
      console.log = (...args) => { printed.push(args.join(" ")); originalLog(...args); };
      const unexpectedRequests = [];
      let requests = 0;
      let transportAborted = false;
      let transportSettled = false;
      let doneCompleted = false;
      let started = Promise.withResolvers();
      const project = { id: "10000000-1000-4000-8000-000000000001", slug: "shutdown-demo" };
      await withTestContext("command-shutdown", async (context) => {
        for (const key of ["VERYFRONT_PROJECT_ID", "TENANT_PROJECT_ID", "TENANT_PROJECT_SLUG"]) deleteEnv(key);
        setEnv("VERYFRONT_API_TOKEN", "shutdown-test-token");
        setEnv("VERYFRONT_API_BASE_URL", "https://api.test");
        setEnv("VERYFRONT_API_URL", "https://api.test");
        setEnv("VERYFRONT_PROJECT_SLUG", project.slug);
        setEnv("STUDIO_URL", "https://studio.test");
        refreshEnvironmentConfig();
        await Deno.writeTextFile(context.projectDir + "/veryfront.config.js", 'export default { ai: { agents: { discovery: { paths: ["crew"] } } } };');
        await Deno.writeTextFile(context.projectDir + "/.vfignore", "**\\n");
        await Deno.mkdir(context.projectDir + "/crew");
        await Deno.writeTextFile(context.projectDir + "/crew/agent.ts", 'export default { id: "shutdown-agent", config: { id: "shutdown-agent", tools: { salesforce__get_case: true } }, generate() { return Promise.resolve({ text: "" }); } };');
        await withMockFetch((input, init) => {
          const url = new URL(input instanceof Request ? input.url : String(input));
          if (url.origin !== "https://api.test") {
            unexpectedRequests.push(url.origin);
            throw new Error("Unexpected outbound origin: " + url.origin);
          }
          if (url.pathname === "/integration-tools") {
            assertEquals(new Headers(init?.headers).get("x-veryfront-project-slug"), project.slug);
            requests++;
            started.resolve();
            return new Promise((resolve, reject) => {
              // Bound a broken shutdown so the regression fails instead of hanging.
              const timeout = setTimeout(() => resolve(Response.json({ tools: [] })), 1500);
              const abort = () => {
                clearTimeout(timeout);
                transportAborted = true;
                reject(init.signal.reason);
              };
              if (init.signal.aborted) abort();
              else init.signal.addEventListener("abort", abort, { once: true });
            }).finally(() => { transportSettled = true; });
          }
          if (url.pathname === "/me") return Promise.resolve(Response.json({ id: "user-test", email: "test@example.com" }));
          if (url.pathname === "/projects") return Promise.resolve(Response.json({ data: [project] }));
          if (url.pathname === "/projects/" + project.slug || url.pathname === "/projects/" + project.id) return Promise.resolve(Response.json(project));
          if (url.pathname === "/projects/" + project.id + "/environments") return Promise.resolve(Response.json({ data: [{ id: "20000000-1000-4000-8000-000000000001", name: "preview", protected: false, project_id: project.id }] }));
          if (url.pathname === "/projects/" + project.id + "/files") return Promise.resolve(Response.json({ data: [] }));
          unexpectedRequests.push(url.pathname);
          throw new Error("Unexpected API request: " + (init?.method ?? "GET") + " " + url.pathname);
        }, async () => {
          for (let cycle = 0; cycle < 2; cycle++) {
          started = Promise.withResolvers();
          transportAborted = false;
          transportSettled = false;
          doneCompleted = false;
          const server = await devCommand({ projectDir: context.projectDir, port: 0, demoMode: true, hmr: false });
          try {
            let startupTimeout;
            try {
              await Promise.race([started.promise, new Promise((_, reject) => {
                startupTimeout = setTimeout(() => reject(new Error("Integration discovery did not start")), 5000);
              })]);
            } finally {
              clearTimeout(startupTimeout);
            }
            diagnosticLogs.length = 0;
            printed.length = 0;
            const done = server.done.then(() => { doneCompleted = true; });
            const stopping = server.stop();
            await server.stop();
            assertEquals(doneCompleted, true, "Concurrent stop must await the same shutdown");
            await stopping;
            await done;
            assertEquals(transportAborted, true);
            assertEquals(transportSettled, true);
            assertEquals(doneCompleted, true);
            const requestCountAtDone = requests;
            await new Promise(resolve => setTimeout(resolve, 400));
            assertEquals(requests, requestCountAtDone);
            assertEquals(requests, cycle + 1);
            assertEquals(unexpectedRequests, []);
            assertEquals(diagnosticLogs, []);
            assertEquals(printed.filter(line => /isn't connected|integration connect|Integration connection check failed/.test(line)), []);
          } finally {
            await server.stop();
          }
          }
        });
      });
      unsubscribe();
      console.log = originalLog;
      Deno.test("command shutdown aborts startup discovery without late diagnostics", () => {
        assertEquals(transportAborted && transportSettled && doneCompleted, true);
      });
    `;
    const scriptPath = `${directory}/command-shutdown.ts`;
    await Deno.writeTextFile(scriptPath, script);
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "test",
        "--frozen",
        "--no-check",
        ...LOOPBACK_TEST_PERMISSIONS,
        PROVIDER_EGRESS_DENY_NET,
        "--config=deno.json",
        scriptPath,
      ],
      cwd: new URL("../../../..", import.meta.url),
      // Restart teardown must not export the host's telemetry configuration.
      env: {
        OTEL_TRACES_ENABLED: "false",
        OTEL_TRACES_EXPORTER: "none",
        OTEL_LOGS_ENABLED: "false",
        OTEL_LOGS_EXPORTER: "none",
        OTEL_METRICS_ENABLED: "false",
        OTEL_METRICS_EXPORTER: "none",
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(
      result.code,
      0,
      new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
    );
  });
});
