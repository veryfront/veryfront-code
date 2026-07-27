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

async function runGit(projectDir: string, ...args: string[]) {
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
}

async function commitProject(projectDir: string) {
  await runGit(projectDir, "init", "--quiet");
  await runGit(projectDir, "config", "user.email", "test@veryfront.com");
  await runGit(projectDir, "config", "user.name", "Veryfront Test");
  await runGit(projectDir, "add", ".");
  await runGit(projectDir, "commit", "--quiet", "-m", "initial");
  return new TextDecoder().decode(
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
}

it("uses canonical production read-back in human and JSON modes", {
  timeout: 30_000,
}, async () => {
  const projectDir = await Deno.makeTempDir();
  const envKeys = ["VERYFRONT_API_TOKEN", "VERYFRONT_API_URL", "VERYFRONT_PROJECT_SLUG"];
  const savedEnv = envKeys.map((key) => Deno.env.get(key));
  const requests: string[] = [];
  let environmentReads = 0;

  try {
    await Deno.writeTextFile(`${projectDir}/.gitignore`, ".veryfront/\n");
    await Deno.writeTextFile(`${projectDir}/veryfront.json`, '{"projectSlug":"my-project"}\n');
    await Deno.writeTextFile(`${projectDir}/app.ts`, "export const value = 1;\n");
    const actualSha = await commitProject(projectDir);
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
        url.pathname.endsWith(`/releases/${RELEASE_ID}/asset-manifest`)
      ) {
        return Response.json({
          state: "ready",
          manifest_version: 1,
          manifest: {
            schemaVersion: 1,
            projectId: PROJECT_ID,
            releaseId: RELEASE_ID,
            releaseVersion: 41,
            manifestVersion: 1,
            builderVersion: "test",
            sourceContentHash: sourceDigest,
            createdAt: "2026-07-10T09:20:00.000Z",
            assetBasePath: "/_vf/assets",
            modules: {
              "app.ts": {
                contentHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                size: 10,
                contentType: "text/javascript",
              },
            },
            css: [],
            routes: {},
            dependencies: {},
            fallback: { mode: "jit", gaps: [] },
          },
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
        skipSourcePush: true,
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
        `GET /api/projects/my-project/releases/${RELEASE_ID}/asset-manifest`,
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
      while (releaseSourceReads < 20) {
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
    assertEquals(requests.slice(0, 5), [
      "GET /api/projects/my-project",
      `GET /api/projects/${PROJECT_ID}/environments`,
      `POST /api/projects/${PROJECT_ID}/releases`,
      `GET /api/projects/${PROJECT_ID}/releases/${RELEASE_ID}`,
      `GET /api/projects/${PROJECT_ID}/releases/${RELEASE_ID}/versions`,
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

it("models an inferred missing project during dry-run deploy", async () => {
  const projectDir = await Deno.makeTempDir();
  const envKeys = [
    "VERYFRONT_API_TOKEN",
    "VERYFRONT_API_URL",
    "VERYFRONT_PROJECT_SLUG",
    "VERYFRONT_PROJECT_ID",
  ];
  const savedEnv = envKeys.map((key) => Deno.env.get(key));
  const requests: string[] = [];

  try {
    await Deno.writeTextFile(`${projectDir}/package.json`, '{"name":"missing-app"}\n');
    Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
    Deno.env.set("VERYFRONT_API_URL", "https://control.example.test/api");
    Deno.env.delete("VERYFRONT_PROJECT_SLUG");
    Deno.env.delete("VERYFRONT_PROJECT_ID");
    _resetEnvironmentConfig();

    await withMockFetch((input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}`);
      return Promise.resolve(Response.json({ message: "not found" }, { status: 404 }));
    }, () =>
      deployCommand({
        projectDir,
        branch: "main",
        env: "production",
        dryRun: true,
        force: true,
        quiet: true,
      }));

    assertEquals(requests, ["GET /api/projects/missing-app"]);
  } finally {
    envKeys.forEach((key, index) => {
      const value = savedEnv[index];
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    });
    _resetEnvironmentConfig();
    await Deno.remove(projectDir, { recursive: true });
  }
});

it("does not claim dry-run deploy would push source when source push is skipped", async () => {
  const projectDir = await Deno.makeTempDir();
  const envKeys = [
    "VERYFRONT_API_TOKEN",
    "VERYFRONT_API_URL",
    "VERYFRONT_PROJECT_SLUG",
    "VERYFRONT_PROJECT_ID",
  ];
  const savedEnv = envKeys.map((key) => Deno.env.get(key));
  const logs: string[] = [];
  const originalLog = console.log;

  try {
    await Deno.writeTextFile(`${projectDir}/package.json`, '{"name":"missing-app"}\n');
    Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
    Deno.env.set("VERYFRONT_API_URL", "https://control.example.test/api");
    Deno.env.delete("VERYFRONT_PROJECT_SLUG");
    Deno.env.delete("VERYFRONT_PROJECT_ID");
    _resetEnvironmentConfig();
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    await withMockFetch(
      (_input: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(Response.json({ message: "not found" }, { status: 404 })),
      () =>
        deployCommand({
          projectDir,
          branch: "main",
          env: "production",
          dryRun: true,
          force: true,
          quiet: false,
          skipSourcePush: true,
        }),
    );

    assertEquals(
      logs.some((line) => line.includes('Would create release and deploy to "production"')),
      true,
    );
    assertEquals(logs.some((line) => line.includes("push source")), false);
  } finally {
    console.log = originalLog;
    envKeys.forEach((key, index) => {
      const value = savedEnv[index];
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    });
    _resetEnvironmentConfig();
    await Deno.remove(projectDir, { recursive: true });
  }
});

it("uses an alternative slug when inferred first deploy project creation conflicts", async () => {
  const projectDir = await Deno.makeTempDir();
  const envKeys = [
    "VERYFRONT_API_TOKEN",
    "VERYFRONT_API_URL",
    "VERYFRONT_PROJECT_SLUG",
    "VERYFRONT_PROJECT_ID",
  ];
  const savedEnv = envKeys.map((key) => Deno.env.get(key));
  const createSlugs: string[] = [];

  try {
    await Deno.writeTextFile(`${projectDir}/.gitignore`, ".veryfront/\n");
    await Deno.writeTextFile(`${projectDir}/package.json`, '{"name":"taken-app"}\n');
    await Deno.writeTextFile(`${projectDir}/app.ts`, "export const value = 1;\n");
    const actualSha = await commitProject(projectDir);
    const sourceDigest = await computeSourceDigest([
      { path: "app.ts", content: "export const value = 1;\n" },
    ]);

    Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
    Deno.env.set("VERYFRONT_API_URL", "https://control.example.test/api");
    Deno.env.delete("VERYFRONT_PROJECT_SLUG");
    Deno.env.delete("VERYFRONT_PROJECT_ID");
    _resetEnvironmentConfig();

    await withMockFetch(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/api/projects/taken-app") {
        return Response.json({ message: "not found" }, { status: 404 });
      }
      if (request.method === "POST" && url.pathname === "/api/projects") {
        const body = await request.json() as { slug: string };
        createSlugs.push(body.slug);
        if (body.slug === "taken-app") {
          return Response.json({ error: "taken" }, { status: 409 });
        }
        assertEquals(/^taken-app-[a-z0-9]+$/.test(body.slug), true);
        await writePushReceipt(projectDir, {
          controlPlane: "https://control.example.test/api",
          projectId: PROJECT_ID,
          projectSlug: body.slug,
          branch: "main",
          commitSha: actualSha,
          sourceDigest,
          clean: true,
          pushedAt: "2026-07-10T09:20:00.000Z",
        });
        return Response.json({ id: PROJECT_ID }, { status: 201 });
      }
      if (request.method === "GET" && url.pathname.endsWith("/environments")) {
        return Response.json({
          data: [{
            id: ENVIRONMENT_ID,
            name: "preview",
            project_id: PROJECT_ID,
            protected: false,
            deployment: {
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
        return Response.json({
          data: [{
            path: "app.ts",
            data: JSON.stringify({ body: "export const value = 1;\n", path: "app.ts" }),
          }],
          page_info: {},
        });
      }
      if (
        request.method === "GET" &&
        url.pathname.endsWith(`/releases/${RELEASE_ID}/asset-manifest`)
      ) {
        return Response.json({
          state: "ready",
          manifest_version: 1,
          manifest: {
            schemaVersion: 1,
            projectId: PROJECT_ID,
            releaseId: RELEASE_ID,
            releaseVersion: 41,
            manifestVersion: 1,
            builderVersion: "test",
            sourceContentHash: sourceDigest,
            createdAt: "2026-07-10T09:20:00.000Z",
            assetBasePath: "/_vf/assets",
            modules: {},
            css: [],
            routes: {},
            dependencies: {},
            fallback: { mode: "jit", gaps: [] },
          },
        });
      }
      if (request.method === "POST" && url.pathname.endsWith("/deployments")) {
        return Response.json({
          id: DEPLOYMENT_ID,
          release_id: RELEASE_ID,
          environment_id: ENVIRONMENT_ID,
          routing_convergence: { status: "converged", acknowledged: 1, recipients: 1 },
        }, { status: 201 });
      }
      if (request.method === "GET" && url.pathname.endsWith(`/deployments/${DEPLOYMENT_ID}`)) {
        return Response.json({
          id: DEPLOYMENT_ID,
          release_id: RELEASE_ID,
          environment_id: ENVIRONMENT_ID,
        });
      }
      return Response.json({ message: "not found" }, { status: 404 });
    }, () =>
      deployCommand({
        projectDir,
        branch: "main",
        env: "preview",
        releaseName: `github-main-${actualSha}`,
        dryRun: false,
        force: true,
        quiet: true,
        skipSourcePush: true,
      }));

    assertEquals(createSlugs.length, 2);
    assertEquals(createSlugs[0], "taken-app");
    assertEquals(/^taken-app-[a-z0-9]+$/.test(createSlugs[1] ?? ""), true);
    const linkedConfig = JSON.parse(await Deno.readTextFile(`${projectDir}/veryfront.json`)) as {
      projectSlug?: string;
    };
    assertEquals(linkedConfig.projectSlug, createSlugs[1]);
  } finally {
    envKeys.forEach((key, index) => {
      const value = savedEnv[index];
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    });
    _resetEnvironmentConfig();
    await Deno.remove(projectDir, { recursive: true });
  }
});

it("collects configured app and pages routes when projectDir has a trailing slash", async () => {
  const projectDir = await Deno.makeTempDir();
  const envKeys = [
    "VERYFRONT_API_TOKEN",
    "VERYFRONT_API_URL",
    "VERYFRONT_PROJECT_SLUG",
    "VERYFRONT_PROJECT_ID",
  ];
  const savedEnv = envKeys.map((key) => Deno.env.get(key));

  try {
    await Deno.mkdir(`${projectDir}/src/site`, { recursive: true });
    await Deno.mkdir(`${projectDir}/src/pages`, { recursive: true });
    await Deno.writeTextFile(`${projectDir}/.gitignore`, ".veryfront/\n");
    await Deno.writeTextFile(
      `${projectDir}/veryfront.config.ts`,
      'export default { projectSlug: "my-project", directories: { app: "src\\\\site", pages: "src\\\\pages" } };\n',
    );
    await Deno.writeTextFile(
      `${projectDir}/src/site/page.tsx`,
      "export default function Page() { return null; }\n",
    );
    await Deno.writeTextFile(
      `${projectDir}/src/pages/about.tsx`,
      "export default function About() { return null; }\n",
    );
    const actualSha = await commitProject(projectDir);
    const sourceDigest = await computeSourceDigest([
      {
        path: "src/site/page.tsx",
        content: "export default function Page() { return null; }\n",
      },
      {
        path: "src/pages/about.tsx",
        content: "export default function About() { return null; }\n",
      },
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
    Deno.env.delete("VERYFRONT_PROJECT_SLUG");
    Deno.env.delete("VERYFRONT_PROJECT_ID");
    _resetEnvironmentConfig();

    await withMockFetch((input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/api/projects/my-project") {
        return Promise.resolve(Response.json({ id: PROJECT_ID, slug: "my-project" }));
      }
      if (request.method === "GET" && url.pathname.endsWith("/environments")) {
        return Promise.resolve(Response.json({
          data: [{
            id: ENVIRONMENT_ID,
            name: "production",
            project_id: PROJECT_ID,
            protected: false,
            deployment: null,
          }],
        }));
      }
      if (request.method === "POST" && url.pathname.endsWith("/releases")) {
        return Promise.resolve(Response.json({
          id: RELEASE_ID,
          name: `github-main-${actualSha}`,
          version: "0.0.41",
          project_id: PROJECT_ID,
        }, { status: 201 }));
      }
      if (request.method === "GET" && url.pathname.endsWith(`/releases/${RELEASE_ID}`)) {
        return Promise.resolve(Response.json({
          id: RELEASE_ID,
          name: `github-main-${actualSha}`,
          version: "0.0.41",
          project_id: PROJECT_ID,
        }));
      }
      if (
        request.method === "GET" &&
        url.pathname.endsWith(`/releases/${RELEASE_ID}/versions`)
      ) {
        return Promise.resolve(Response.json({
          data: [{
            path: "src/site/page.tsx",
            data: JSON.stringify({
              body: "export default function Page() { return null; }\n",
              path: "src/site/page.tsx",
            }),
          }, {
            path: "src/pages/about.tsx",
            data: JSON.stringify({
              body: "export default function About() { return null; }\n",
              path: "src/pages/about.tsx",
            }),
          }],
          page_info: {},
        }));
      }
      if (
        request.method === "GET" &&
        url.pathname.endsWith(`/releases/${RELEASE_ID}/asset-manifest`)
      ) {
        return Promise.resolve(Response.json({
          state: "ready",
          manifest_version: 1,
          manifest: {
            schemaVersion: 1,
            projectId: PROJECT_ID,
            releaseId: RELEASE_ID,
            releaseVersion: 41,
            manifestVersion: 1,
            builderVersion: "test",
            sourceContentHash: sourceDigest,
            createdAt: "2026-07-10T09:20:00.000Z",
            assetBasePath: "/_vf/assets",
            modules: {},
            css: [],
            routes: {},
            dependencies: {},
            fallback: { mode: "jit", gaps: [] },
          },
        }));
      }
      return Promise.resolve(Response.json({ message: "not found" }, { status: 404 }));
    }, () =>
      assertRejects(
        () =>
          deployCommand({
            projectDir: `${projectDir}/`,
            branch: "main",
            env: "production",
            releaseName: `github-main-${actualSha}`,
            dryRun: false,
            force: true,
            quiet: true,
            skipSourcePush: true,
          }),
        Error,
        "Missing routes: /, /about",
      ));
  } finally {
    envKeys.forEach((key, index) => {
      const value = savedEnv[index];
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    });
    _resetEnvironmentConfig();
    await Deno.remove(projectDir, { recursive: true });
  }
});

it("rejects configured route directories outside projectDir before walking", async () => {
  const projectDir = await Deno.makeTempDir();
  const envKeys = [
    "VERYFRONT_API_TOKEN",
    "VERYFRONT_API_URL",
    "VERYFRONT_PROJECT_SLUG",
    "VERYFRONT_PROJECT_ID",
  ];
  const savedEnv = envKeys.map((key) => Deno.env.get(key));
  const requests: string[] = [];
  const releaseSource = "export const value = 1;\n";

  try {
    await Deno.writeTextFile(`${projectDir}/.gitignore`, ".veryfront/\n");
    await Deno.writeTextFile(
      `${projectDir}/veryfront.config.ts`,
      'export default { projectSlug: "my-project", directories: { app: "../outside", pages: "src/pages" } };\n',
    );
    await Deno.writeTextFile(`${projectDir}/app.ts`, releaseSource);
    const actualSha = await commitProject(projectDir);
    const sourceDigest = await computeSourceDigest([
      { path: "app.ts", content: releaseSource },
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
    Deno.env.delete("VERYFRONT_PROJECT_SLUG");
    Deno.env.delete("VERYFRONT_PROJECT_ID");
    _resetEnvironmentConfig();

    await withMockFetch((input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}`);

      if (request.method === "GET" && url.pathname === "/api/projects/my-project") {
        return Promise.resolve(Response.json({ id: PROJECT_ID, slug: "my-project" }));
      }
      if (request.method === "GET" && url.pathname.endsWith("/environments")) {
        return Promise.resolve(Response.json({
          data: [{
            id: ENVIRONMENT_ID,
            name: "production",
            project_id: PROJECT_ID,
            protected: false,
            deployment: null,
          }],
        }));
      }
      if (request.method === "POST" && url.pathname.endsWith("/releases")) {
        return Promise.resolve(Response.json({
          id: RELEASE_ID,
          name: `github-main-${actualSha}`,
          version: "0.0.41",
          project_id: PROJECT_ID,
        }, { status: 201 }));
      }
      if (request.method === "GET" && url.pathname.endsWith(`/releases/${RELEASE_ID}`)) {
        return Promise.resolve(Response.json({
          id: RELEASE_ID,
          name: `github-main-${actualSha}`,
          version: "0.0.41",
          project_id: PROJECT_ID,
        }));
      }
      if (
        request.method === "GET" &&
        url.pathname.endsWith(`/releases/${RELEASE_ID}/versions`)
      ) {
        return Promise.resolve(Response.json({
          data: [{
            path: "app.ts",
            data: JSON.stringify({ body: releaseSource, path: "app.ts" }),
          }],
          page_info: {},
        }));
      }
      return Promise.resolve(Response.json({ message: "not found" }, { status: 404 }));
    }, () =>
      assertRejects(
        () =>
          deployCommand({
            projectDir,
            branch: "main",
            env: "production",
            releaseName: `github-main-${actualSha}`,
            dryRun: false,
            force: true,
            quiet: true,
            skipSourcePush: true,
          }),
        Error,
        'Configured app directory "../outside" resolves outside the project directory',
      ));

    assertEquals(
      requests.some((request) => request.endsWith(`/releases/${RELEASE_ID}/asset-manifest`)),
      false,
    );
  } finally {
    envKeys.forEach((key, index) => {
      const value = savedEnv[index];
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    });
    _resetEnvironmentConfig();
    await Deno.remove(projectDir, { recursive: true });
  }
});

it("rejects absolute configured route directories before walking", async () => {
  const cases = [
    {
      app: "/project/src/site",
      message: 'Configured app directory "/project/src/site" must be project-relative',
    },
    {
      app: "C:/project/src/site",
      message: 'Configured app directory "C:/project/src/site" must be project-relative',
    },
    {
      app: "\\\\server\\share\\site",
      message: 'Configured app directory "//server/share/site" must be project-relative',
    },
  ];

  for (const testCase of cases) {
    const projectDir = await Deno.makeTempDir();
    const envKeys = [
      "VERYFRONT_API_TOKEN",
      "VERYFRONT_API_URL",
      "VERYFRONT_PROJECT_SLUG",
      "VERYFRONT_PROJECT_ID",
    ];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));
    const requests: string[] = [];
    const releaseSource = "export const value = 1;\n";

    try {
      await Deno.writeTextFile(`${projectDir}/.gitignore`, ".veryfront/\n");
      await Deno.writeTextFile(
        `${projectDir}/veryfront.config.ts`,
        `export default { projectSlug: "my-project", directories: { app: ${
          JSON.stringify(testCase.app)
        }, pages: "src/pages" } };\n`,
      );
      await Deno.writeTextFile(`${projectDir}/app.ts`, releaseSource);
      const actualSha = await commitProject(projectDir);
      const sourceDigest = await computeSourceDigest([
        { path: "app.ts", content: releaseSource },
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
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      Deno.env.delete("VERYFRONT_PROJECT_ID");
      _resetEnvironmentConfig();

      await withMockFetch((input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        requests.push(`${request.method} ${url.pathname}`);

        if (request.method === "GET" && url.pathname === "/api/projects/my-project") {
          return Promise.resolve(Response.json({ id: PROJECT_ID, slug: "my-project" }));
        }
        if (request.method === "GET" && url.pathname.endsWith("/environments")) {
          return Promise.resolve(Response.json({
            data: [{
              id: ENVIRONMENT_ID,
              name: "production",
              project_id: PROJECT_ID,
              protected: false,
              deployment: null,
            }],
          }));
        }
        if (request.method === "POST" && url.pathname.endsWith("/releases")) {
          return Promise.resolve(Response.json({
            id: RELEASE_ID,
            name: `github-main-${actualSha}`,
            version: "0.0.41",
            project_id: PROJECT_ID,
          }, { status: 201 }));
        }
        if (request.method === "GET" && url.pathname.endsWith(`/releases/${RELEASE_ID}`)) {
          return Promise.resolve(Response.json({
            id: RELEASE_ID,
            name: `github-main-${actualSha}`,
            version: "0.0.41",
            project_id: PROJECT_ID,
          }));
        }
        if (
          request.method === "GET" &&
          url.pathname.endsWith(`/releases/${RELEASE_ID}/versions`)
        ) {
          return Promise.resolve(Response.json({
            data: [{
              path: "app.ts",
              data: JSON.stringify({ body: releaseSource, path: "app.ts" }),
            }],
            page_info: {},
          }));
        }
        return Promise.resolve(Response.json({ message: "not found" }, { status: 404 }));
      }, () =>
        assertRejects(
          () =>
            deployCommand({
              projectDir,
              branch: "main",
              env: "production",
              releaseName: `github-main-${actualSha}`,
              dryRun: false,
              force: true,
              quiet: true,
              skipSourcePush: true,
            }),
          Error,
          testCase.message,
        ));

      assertEquals(
        requests.some((request) => request.endsWith(`/releases/${RELEASE_ID}/asset-manifest`)),
        false,
      );
    } finally {
      envKeys.forEach((key, index) => {
        const value = savedEnv[index];
        if (value === undefined) Deno.env.delete(key);
        else Deno.env.set(key, value);
      });
      _resetEnvironmentConfig();
      await Deno.remove(projectDir, { recursive: true });
    }
  }
});

it("preserves explicit project ids during deploy project lookup", async () => {
  const projectDir = await Deno.makeTempDir();
  const envKeys = [
    "VERYFRONT_API_TOKEN",
    "VERYFRONT_API_URL",
    "VERYFRONT_PROJECT_SLUG",
    "VERYFRONT_PROJECT_ID",
  ];
  const savedEnv = envKeys.map((key) => Deno.env.get(key));
  const requests: string[] = [];

  try {
    await Deno.writeTextFile(`${projectDir}/package.json`, '{"name":"ignored-name"}\n');
    Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
    Deno.env.set("VERYFRONT_API_URL", "https://control.example.test/api");
    Deno.env.delete("VERYFRONT_PROJECT_SLUG");
    Deno.env.set("VERYFRONT_PROJECT_ID", "proj_123");
    _resetEnvironmentConfig();

    await withMockFetch((input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}`);
      return Promise.resolve(Response.json({ message: "not found" }, { status: 404 }));
    }, () =>
      assertRejects(
        () =>
          deployCommand({
            projectDir,
            branch: "main",
            env: "production",
            dryRun: true,
            force: true,
            quiet: true,
          }),
        Error,
        'Project "proj_123" was not found',
      ));

    assertEquals(requests, ["GET /api/projects/proj_123"]);
  } finally {
    envKeys.forEach((key, index) => {
      const value = savedEnv[index];
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    });
    _resetEnvironmentConfig();
    await Deno.remove(projectDir, { recursive: true });
  }
});
