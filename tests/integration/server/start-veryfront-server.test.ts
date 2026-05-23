/**
 * Smoke tests for the unified startServer entry point.
 *
 * Verifies that both development and production mode dispatch correctly
 * and that the VeryfrontServerHandle lifecycle (ready/stop) works.
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { join } from "#veryfront/compat/path";
import { writeTextFile } from "#veryfront/testing/deno-compat";

import { startServer } from "../../../src/server/index.ts";
import {
  getMemoryMonitoringState,
  stopMemoryMonitoring,
} from "../../../src/utils/memory/profiler.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { restoreLogs } from "../../_helpers/log-guard.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";

describe(
  "startServer",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    afterAll(async () => {
      stopMemoryMonitoring();
      await cleanupBundler();
      restoreLogs();
    });

    it("starts and stops in production mode (default)", async () => {
      await withTestContext("unified-prod-mode", async (context) => {
        await writeTextFile(
          join(context.projectDir, "public", "health.txt"),
          "ok",
        );

        const port = await context.allocatePort();
        const controller = new AbortController();

        const server = await startServer({
          mode: "production",
          projectDir: context.projectDir,
          port,
          bindAddress: "127.0.0.1",
          signal: controller.signal,
          defaultProjectSlug: context.projectId,
          defaultProjectId: context.projectId,
          localProjects: { [context.projectId]: context.projectDir },
        });

        context.addCleanup(async () => {
          try {
            controller.abort();
            await server.stop();
          } catch {
            // Server may already be stopped
          }
        });

        await server.ready;

        const res = await fetch(`http://127.0.0.1:${port}/health.txt`);
        assertEquals(res.status, 200, "Production mode should serve files");
        assertEquals(await res.text(), "ok");
      });
    });

    it("enables memory monitoring from production server env", async () => {
      const previousEnabled = Deno.env.get("ENABLE_MEMORY_MONITORING");
      const previousInterval = Deno.env.get("MEMORY_MONITORING_INTERVAL_MS");

      Deno.env.set("ENABLE_MEMORY_MONITORING", "true");
      Deno.env.set("MEMORY_MONITORING_INTERVAL_MS", "60000");
      stopMemoryMonitoring();

      try {
        await withTestContext("unified-prod-memory-monitoring", async (context) => {
          const port = await context.allocatePort();
          const controller = new AbortController();

          const server = await startServer({
            mode: "production",
            projectDir: context.projectDir,
            port,
            bindAddress: "127.0.0.1",
            signal: controller.signal,
            defaultProjectSlug: context.projectId,
            defaultProjectId: context.projectId,
            localProjects: { [context.projectId]: context.projectDir },
          });

          let stopped = false;
          context.addCleanup(async () => {
            if (stopped) return;
            try {
              controller.abort();
              await server.stop();
            } catch {
              // Server may already be stopped
            }
          });

          await server.ready;

          assertEquals(getMemoryMonitoringState(), {
            active: true,
            intervalMs: 60000,
          });

          await server.stop();
          stopped = true;
          assertEquals(getMemoryMonitoringState(), {
            active: false,
            intervalMs: undefined,
          });
        });
      } finally {
        stopMemoryMonitoring();
        if (previousEnabled === undefined) Deno.env.delete("ENABLE_MEMORY_MONITORING");
        else Deno.env.set("ENABLE_MEMORY_MONITORING", previousEnabled);

        if (previousInterval === undefined) Deno.env.delete("MEMORY_MONITORING_INTERVAL_MS");
        else Deno.env.set("MEMORY_MONITORING_INTERVAL_MS", previousInterval);
      }
    });

    it("cleans up memory monitoring when production startup fails", async () => {
      const previousEnabled = Deno.env.get("ENABLE_MEMORY_MONITORING");
      const previousInterval = Deno.env.get("MEMORY_MONITORING_INTERVAL_MS");

      Deno.env.set("ENABLE_MEMORY_MONITORING", "true");
      Deno.env.set("MEMORY_MONITORING_INTERVAL_MS", "60000");
      stopMemoryMonitoring();

      try {
        await withTestContext("unified-prod-memory-monitoring-startup-failure", async (context) => {
          const port = await context.allocatePort();

          await assertRejects(async () => {
            await startServer({
              mode: "production",
              projectDir: context.projectDir,
              port,
              // TEST-NET-3 address should not be bindable in local test env.
              bindAddress: "203.0.113.1",
              defaultProjectSlug: context.projectId,
              defaultProjectId: context.projectId,
              localProjects: { [context.projectId]: context.projectDir },
            });
          });

          assertEquals(getMemoryMonitoringState(), {
            active: false,
            intervalMs: undefined,
          });
        });
      } finally {
        stopMemoryMonitoring();
        if (previousEnabled === undefined) Deno.env.delete("ENABLE_MEMORY_MONITORING");
        else Deno.env.set("ENABLE_MEMORY_MONITORING", previousEnabled);

        if (previousInterval === undefined) Deno.env.delete("MEMORY_MONITORING_INTERVAL_MS");
        else Deno.env.set("MEMORY_MONITORING_INTERVAL_MS", previousInterval);
      }
    });

    it("starts and stops in development mode", async () => {
      await withTestContext("unified-dev-mode", async (context) => {
        await writeTextFile(
          join(context.projectDir, "public", "health.txt"),
          "ok",
        );

        const port = await context.allocatePort();
        const server = await startServer({
          mode: "development",
          projectDir: context.projectDir,
          port,
          bindAddress: "127.0.0.1",
          enableHMR: false,
          defaultProjectSlug: context.projectId,
          defaultProjectId: context.projectId,
        });

        context.addCleanup(async () => {
          try {
            await server.stop();
          } catch {
            // Server may already be stopped
          }
        });

        await server.ready;

        const res = await fetch(`http://127.0.0.1:${port}/health.txt`);
        assertEquals(res.status, 200, "Dev mode should serve files");
        assertEquals(await res.text(), "ok");
      });
    });

    it("honors bindAddress in development mode", async () => {
      await withTestContext("unified-dev-bind-address", async (context) => {
        const port = await context.allocatePort();

        await assertRejects(async () => {
          const server = await startServer({
            mode: "development",
            projectDir: context.projectDir,
            port,
            // TEST-NET-3 address should not be bindable in local test env.
            bindAddress: "203.0.113.1",
            enableHMR: false,
            defaultProjectSlug: context.projectId,
            defaultProjectId: context.projectId,
          });

          await server.stop();
        });
      });
    });

    it("defaults to production mode when mode is omitted", async () => {
      await withTestContext("unified-default-mode", async (context) => {
        await writeTextFile(
          join(context.projectDir, "public", "test.txt"),
          "default",
        );

        const port = await context.allocatePort();
        const controller = new AbortController();

        const server = await startServer({
          projectDir: context.projectDir,
          port,
          bindAddress: "127.0.0.1",
          signal: controller.signal,
          defaultProjectSlug: context.projectId,
          defaultProjectId: context.projectId,
          localProjects: { [context.projectId]: context.projectDir },
        });

        context.addCleanup(async () => {
          try {
            controller.abort();
            await server.stop();
          } catch {
            // Server may already be stopped
          }
        });

        await server.ready;

        const res = await fetch(`http://127.0.0.1:${port}/test.txt`);
        assertEquals(res.status, 200, "Default mode should serve files");
        assertEquals(await res.text(), "default");
      });
    });
  },
);
