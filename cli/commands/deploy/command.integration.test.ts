import "#veryfront/schemas/_test-setup.ts";

import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { computeSourceDigest, writePushReceipt } from "../../shared/deployment-provenance.ts";
import { setJsonMode } from "../../shared/json-output.ts";
import { deployCommand, type DeploymentRoutingConvergence } from "./command.ts";
import { FakeTime } from "#std/testing/time";

const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440000";
const ENVIRONMENT_ID = "660e8400-e29b-41d4-a716-446655440000";
const RELEASE_ID = "770e8400-e29b-41d4-a716-446655440000";
const DEPLOYMENT_ID = "880e8400-e29b-41d4-a716-446655440000";

it("uses canonical production read-back in human and JSON modes", async () => {
  const projectDir = await Deno.makeTempDir();
  const envKeys = ["VERYFRONT_API_TOKEN", "VERYFRONT_API_URL", "VERYFRONT_PROJECT_SLUG"];
  const savedEnv = envKeys.map((key) => Deno.env.get(key));
  const requests: string[] = [];
  let environmentReads = 0;

  const runGit = async (...args: string[]) => {
    const result = await new Deno.Command("git", {
      args,
      cwd: projectDir,
      clearEnv: true,
      env: Object.fromEntries(
        Object.entries(Deno.env.toObject()).filter(([key]) => !key.startsWith("GIT_")),
      ),
      stdout: "null",
      stderr: "piped",
    }).output();
    assertEquals(result.success, true, new TextDecoder().decode(result.stderr));
  };

  try {
    await runGit("init", "--quiet");
    await runGit("config", "user.email", "test@veryfront.com");
    await runGit("config", "user.name", "Veryfront Test");
    await Deno.writeTextFile(`${projectDir}/.gitignore`, ".veryfront/\n");
    await Deno.writeTextFile(`${projectDir}/app.ts`, "export const value = 1;\n");
    await runGit("add", ".");
    await runGit("commit", "--quiet", "-m", "initial");
    const actualSha = new TextDecoder().decode(
      (await new Deno.Command("git", {
        args: ["rev-parse", "HEAD"],
        cwd: projectDir,
        clearEnv: true,
        env: Object.fromEntries(
          Object.entries(Deno.env.toObject()).filter(([key]) => !key.startsWith("GIT_")),
        ),
        stdout: "piped",
      }).output()).stdout,
    ).trim();
    const sourceDigest = await computeSourceDigest([
      { path: "app.ts", content: "export const value = 1;\n" },
    ]);

    await writePushReceipt(projectDir, {
      controlPlane: "https://control.example.test/api",
      projectId: PROJECT_ID,
      projectSlug: "my-project",
      branch: "main",
      commitSha: actualSha,
      sourceDigest,
      clean: true,
      pushedAt: "2026-07-10T09:20:00.000Z",
    });

    Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
    Deno.env.set("VERYFRONT_API_URL", "https://control.example.test/api");
    Deno.env.set("VERYFRONT_PROJECT_SLUG", "my-project");
    _resetEnvironmentConfig();

    const currentReleaseSource = "export const value = 1;\n";
    let releaseSourceContents: string[] | null = null;
    let releaseSourceReads = 0;
    let releaseSourceReadGate: Promise<void> | null = null;
    let notifyReleaseSourceRead: (() => void) | null = null;
    let routingConvergence: DeploymentRoutingConvergence = {
      status: "converged",
      acknowledged: 2,
      recipients: 2,
    };
    const handleRequest = async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}`);

      if (request.method === "GET" && url.pathname === "/api/projects/my-project") {
        return Response.json({ id: PROJECT_ID, slug: "my-project" });
      }
      if (request.method === "GET" && url.pathname.endsWith("/environments")) {
        environmentReads++;
        return Response.json({
          data: [{
            id: ENVIRONMENT_ID,
            name: "production",
            project_id: PROJECT_ID,
            protected: true,
            deployment: environmentReads === 1 ? null : {
              id: DEPLOYMENT_ID,
              release: { id: RELEASE_ID, name: `github-main-${actualSha}` },
            },
          }],
        });
      }
      if (request.method === "POST" && url.pathname.endsWith("/releases")) {
        return Response.json({
          id: RELEASE_ID,
          name: `github-main-${actualSha}`,
          version: "0.0.41",
          project_id: PROJECT_ID,
        }, { status: 201 });
      }
      if (request.method === "POST" && url.pathname.endsWith("/deployments")) {
        return Response.json({
          id: DEPLOYMENT_ID,
          release_id: RELEASE_ID,
          environment_id: ENVIRONMENT_ID,
          routing_convergence: routingConvergence,
        }, { status: 201 });
      }
      if (request.method === "GET" && url.pathname.endsWith(`/deployments/${DEPLOYMENT_ID}`)) {
        return Response.json({
          id: DEPLOYMENT_ID,
          release_id: RELEASE_ID,
          environment_id: ENVIRONMENT_ID,
        });
      }
      if (request.method === "GET" && url.pathname.endsWith(`/releases/${RELEASE_ID}`)) {
        return Response.json({
          id: RELEASE_ID,
          name: `github-main-${actualSha}`,
          version: "0.0.41",
          project_id: PROJECT_ID,
        });
      }
      if (
        request.method === "GET" &&
        url.pathname.endsWith(`/releases/${RELEASE_ID}/versions`)
      ) {
        releaseSourceReads++;
        notifyReleaseSourceRead?.();
        notifyReleaseSourceRead = null;
        if (releaseSourceReadGate) await releaseSourceReadGate;
        return Response.json({
          data: [{
            path: "app.ts",
            data: JSON.stringify({
              body: releaseSourceContents?.shift() ?? currentReleaseSource,
              path: "app.ts",
            }),
          }],
          page_info: {},
        });
      }
      return Response.json({ message: "not found" }, { status: 404 });
    };

    const runDeploy = () =>
      deployCommand({
        projectDir,
        branch: "main",
        env: "production",
        releaseName: `github-main-${actualSha}`,
        dryRun: false,
        force: true,
        quiet: true,
      });

    for (const jsonMode of [false, true]) {
      setJsonMode(jsonMode);
      requests.length = 0;
      environmentReads = 0;
      releaseSourceReads = 0;
      releaseSourceContents = ["export const value = 0;\n", currentReleaseSource];

      await withMockFetch(handleRequest, runDeploy);

      assertEquals(environmentReads, 2);
      assertEquals(releaseSourceReads, 2);
      assertEquals(requests, [
        "GET /api/projects/my-project",
        `GET /api/projects/${PROJECT_ID}/environments`,
        `POST /api/projects/${PROJECT_ID}/releases`,
        `GET /api/projects/${PROJECT_ID}/releases/${RELEASE_ID}`,
        `GET /api/projects/${PROJECT_ID}/releases/${RELEASE_ID}/versions`,
        `GET /api/projects/${PROJECT_ID}/releases/${RELEASE_ID}/versions`,
        `POST /api/projects/${PROJECT_ID}/deployments`,
        `GET /api/projects/${PROJECT_ID}/deployments/${DEPLOYMENT_ID}`,
        `GET /api/projects/${PROJECT_ID}/environments`,
      ]);
    }

    setJsonMode(false);
    routingConvergence = { status: "pending" };
    requests.length = 0;
    environmentReads = 0;
    releaseSourceReads = 0;
    releaseSourceContents = null;

    await withMockFetch(handleRequest, runDeploy);
    assertEquals(environmentReads, 2);

    setJsonMode(false);
    releaseSourceContents = Array.from(
      { length: 20 },
      () => "export const value = 2;\n",
    );
    requests.length = 0;
    environmentReads = 0;
    releaseSourceReads = 0;

    const firstReleaseSourceRead = new Promise<void>((resolve) => {
      notifyReleaseSourceRead = resolve;
    });
    let resumeReleaseSourceRead!: () => void;
    releaseSourceReadGate = new Promise<void>((resolve) => {
      resumeReleaseSourceRead = resolve;
    });
    const deployment = withMockFetch(handleRequest, runDeploy);
    await firstReleaseSourceRead;
    {
      using time = new FakeTime();
      resumeReleaseSourceRead();
      await time.tickAsync(0);
      for (
        let tick = 0;
        releaseSourceReads < 20 && tick < 40;
        tick++
      ) {
        await time.tickAsync(500);
      }
      assertEquals(
        releaseSourceReads,
        20,
        "release-source polling did not exhaust its fixed read budget",
      );
      await assertRejects(
        () => deployment,
        Error,
        "does not match pushed commit",
      );
    }
    releaseSourceReadGate = null;
    assertEquals(environmentReads, 1);
    assertEquals(releaseSourceReads, 20);
    assertEquals(requests.slice(0, 4), [
      "GET /api/projects/my-project",
      `GET /api/projects/${PROJECT_ID}/environments`,
      `POST /api/projects/${PROJECT_ID}/releases`,
      `GET /api/projects/${PROJECT_ID}/releases/${RELEASE_ID}`,
    ]);
    assertEquals(
      requests.filter((request) =>
        request ===
          `GET /api/projects/${PROJECT_ID}/releases/${RELEASE_ID}/versions`
      ).length,
      20,
    );
    assertEquals(
      requests.includes(`POST /api/projects/${PROJECT_ID}/deployments`),
      false,
    );
  } finally {
    envKeys.forEach((key, index) => {
      const value = savedEnv[index];
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    });
    _resetEnvironmentConfig();
    setJsonMode(false);
    await Deno.remove(projectDir, { recursive: true });
  }
});
