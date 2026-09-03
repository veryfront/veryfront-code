import "#veryfront/schemas/_test-setup.ts";

import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { computeSourceDigest, writePushReceipt } from "../../shared/deployment-provenance.ts";
import { setJsonMode } from "../../shared/json-output.ts";
import { readProjectLink, writeProjectLink } from "../../shared/project-link.ts";
import { computeContentDigest, writeSyncTarget } from "../../sync/state.ts";
import { deployCommand } from "./command.ts";
import { createDeployProject, type DeployProject } from "../../shared/deployment/deploy-project.ts";
import type { DeploymentRoutingConvergence } from "../../shared/deployment/control-plane.ts";
import { FakeTime } from "#std/testing/time";
import { stripAnsi } from "../../ui/ansi.ts";
import { setVerboseMode } from "../../utils/index.ts";
import { RELEASE_ASSET_MANIFEST_SCHEMA_VERSION } from "veryfront/release-assets";

/**
 * The real Deploy Execution module with test-bounded polling: these suites
 * drive deploy end to end over a fetch stub, they never fake the module.
 */
function boundedDeployProject(): DeployProject {
  return createDeployProject({
    polling: { environmentPollIntervalMs: 1, environmentTimeoutMs: 1_000 },
  });
}

const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440000";
const ENVIRONMENT_ID = "660e8400-e29b-41d4-a716-446655440000";
/** A project this directory never pushed, resolvable so only the receipt refuses. */
const OTHER_PROJECT_SLUG = "other-project";
const OTHER_PROJECT_ID = "770e8400-e29b-41d4-a716-446655440000";
const RELEASE_ID = "770e8400-e29b-41d4-a716-446655440000";
const DEPLOYMENT_ID = "880e8400-e29b-41d4-a716-446655440000";
const PUSHED_SOURCE = "export const value = 1;\n";
/** A stable stand-in for the version id the control plane assigns each file. */
function remoteVersionId(path: string): string {
  return `version-${path}`;
}

const STALE_SOURCE = "export const value = 2;\n";

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

async function withDeployEnv<T>(
  projectDir: string,
  fn: (context: { commitSha: string; sourceDigest: string }) => Promise<T>,
  /** Extra source committed with the rest, so the checkout still starts clean. */
  extraFiles: Readonly<Record<string, string>> = {},
): Promise<T> {
  const envKeys = [
    "GITHUB_SHA",
    "VERYFRONT_API_TOKEN",
    "VERYFRONT_API_URL",
    "VERYFRONT_PROJECT_SLUG",
    "VERYFRONT_PROJECT_ID",
  ];
  const savedEnv = envKeys.map((key) => Deno.env.get(key));

  try {
    await Deno.writeTextFile(`${projectDir}/.gitignore`, ".veryfront/\n");
    await Deno.writeTextFile(`${projectDir}/veryfront.json`, '{"projectSlug":"my-project"}\n');
    await Deno.writeTextFile(`${projectDir}/app.ts`, PUSHED_SOURCE);
    for (const [path, content] of Object.entries(extraFiles)) {
      await Deno.writeTextFile(`${projectDir}/${path}`, content);
    }
    const commitSha = await commitProject(projectDir);
    const sourceDigest = await computeSourceDigest([
      { path: "app.ts", content: PUSHED_SOURCE },
      { path: "veryfront.json", content: '{"projectSlug":"my-project"}\n' },
      ...Object.entries(extraFiles).map(([path, content]) => ({ path, content })),
    ]);

    Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
    Deno.env.set("VERYFRONT_API_URL", "https://control.example.test/api");
    Deno.env.set("VERYFRONT_PROJECT_SLUG", "my-project");
    Deno.env.set("GITHUB_SHA", commitSha);
    Deno.env.delete("VERYFRONT_PROJECT_ID");
    _resetEnvironmentConfig();

    return await fn({ commitSha, sourceDigest });
  } finally {
    envKeys.forEach((key, index) => {
      const value = savedEnv[index];
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    });
    _resetEnvironmentConfig();
    setJsonMode(false);
    setVerboseMode(false);
    await Deno.remove(projectDir, { recursive: true });
  }
}

function createDeployFetchHandler(options: {
  requests: string[];
  releaseSource?: string;
  sourceDigest: string;
  uploadedPaths?: string[];
  uploadedFiles?: Map<string, string>;
  deletedPaths?: string[];
  releaseFiles?: Map<string, string>;
  branchCreates?: string[];
  onRequest?: (request: Request) => void | Promise<void>;
}) {
  let environmentReads = 0;
  const releaseSource = options.releaseSource ?? PUSHED_SOURCE;
  const uploadedFiles = options.uploadedFiles ?? new Map<string, string>();
  const remoteFileList = () => ({
    data: [...uploadedFiles].map(([path, content]) => ({
      path,
      content,
      version_id: remoteVersionId(path),
    })),
    page_info: {},
  });

  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const requestKey = `${request.method} ${url.pathname}${url.search}`;
    options.requests.push(requestKey);
    await options.onRequest?.(request);

    if (request.method === "GET" && url.hostname === "my-project.production.veryfront.com") {
      return new Response("ready");
    }
    if (request.method === "GET" && url.pathname === "/api/projects/my-project") {
      return Response.json({ id: PROJECT_ID, slug: "my-project" });
    }
    // Resolves cleanly on purpose. Without it a test naming another project
    // fails on this lookup, which looks like the refusal it was written to
    // prove and is not.
    if (request.method === "GET" && url.pathname === `/api/projects/${OTHER_PROJECT_SLUG}`) {
      return Response.json({ id: OTHER_PROJECT_ID, slug: OTHER_PROJECT_SLUG });
    }
    if (
      request.method === "GET" &&
      url.pathname === `/api/projects/${OTHER_PROJECT_ID}/environments`
    ) {
      return Response.json({
        data: [{
          id: ENVIRONMENT_ID,
          name: "production",
          project_id: OTHER_PROJECT_ID,
          protected: false,
          domains: [],
        }],
      });
    }
    if (request.method === "GET" && url.pathname === "/api/projects/my-project/files") {
      return Response.json(remoteFileList());
    }
    if (request.method === "GET" && url.pathname === `/api/projects/${PROJECT_ID}/files`) {
      return Response.json(remoteFileList());
    }
    if (request.method === "GET" && url.pathname === `/api/projects/${PROJECT_ID}`) {
      return Response.json({ id: PROJECT_ID, slug: "my-project" });
    }
    if (request.method === "POST" && url.pathname === `/api/projects/${PROJECT_ID}/branches`) {
      const body = await request.json() as { name?: string };
      options.branchCreates?.push(body.name ?? "");
      return Response.json({ id: "branch-feature", name: body.name, projectId: PROJECT_ID });
    }
    if (request.method === "GET" && url.pathname === `/api/projects/${PROJECT_ID}/branches`) {
      return Response.json({ data: [], page_info: {} });
    }
    if (
      request.method === "PUT" &&
      (url.pathname.startsWith(`/api/projects/${PROJECT_ID}/files/`) ||
        url.pathname.startsWith("/api/projects/my-project/files/"))
    ) {
      const path = decodeURIComponent(url.pathname.split("/files/")[1] ?? "");
      const body = await request.clone().json() as { content: string };
      uploadedFiles.set(path, body.content);
      options.uploadedPaths?.push(path);
      return Response.json({});
    }
    if (
      request.method === "DELETE" &&
      (url.pathname.startsWith(`/api/projects/${PROJECT_ID}/files/`) ||
        url.pathname.startsWith("/api/projects/my-project/files/"))
    ) {
      const path = decodeURIComponent(url.pathname.split("/files/")[1] ?? "");
      uploadedFiles.delete(path);
      options.deletedPaths?.push(path);
      return Response.json({});
    }
    if (request.method === "GET" && url.pathname.endsWith("/environments")) {
      environmentReads++;
      return Response.json({
        data: [{
          id: ENVIRONMENT_ID,
          name: "production",
          project_id: PROJECT_ID,
          protected: false,
          deployment: environmentReads === 1 ? null : {
            id: DEPLOYMENT_ID,
            release: { id: RELEASE_ID, name: "production-release" },
          },
        }],
      });
    }
    if (request.method === "POST" && url.pathname.endsWith("/releases")) {
      return Response.json({
        id: RELEASE_ID,
        name: "production-release",
        version: "0.0.41",
        project_id: PROJECT_ID,
      }, { status: 201 });
    }
    if (request.method === "GET" && url.pathname.endsWith(`/releases/${RELEASE_ID}`)) {
      return Response.json({
        id: RELEASE_ID,
        name: "production-release",
        version: "0.0.41",
        project_id: PROJECT_ID,
      });
    }
    if (request.method === "GET" && url.pathname.endsWith(`/releases/${RELEASE_ID}/versions`)) {
      if (options.releaseFiles) {
        return Response.json({
          data: [...options.releaseFiles].map(([path, body]) => ({
            path,
            data: JSON.stringify({ body, path }),
          })),
          page_info: {},
        });
      }
      return Response.json({
        data: [
          {
            path: "app.ts",
            data: JSON.stringify({ body: releaseSource, path: "app.ts" }),
          },
          {
            path: "veryfront.json",
            data: JSON.stringify({
              body: '{"projectSlug":"my-project"}\n',
              path: "veryfront.json",
            }),
          },
        ],
        page_info: {},
      });
    }
    if (
      request.method === "GET" && url.pathname.endsWith(`/releases/${RELEASE_ID}/asset-manifest`)
    ) {
      return Response.json({
        state: "ready",
        manifest_version: 1,
        manifest: {
          schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
          projectId: PROJECT_ID,
          releaseId: RELEASE_ID,
          releaseVersion: 41,
          manifestVersion: 1,
          builderVersion: "test",
          sourceContentHash: options.sourceDigest.slice("sha256:".length),
          createdAt: "2026-07-10T09:20:00.000Z",
          assetBasePath: "/_vf/assets",
          modules: {},
          css: [],
          routes: {},
          dependencyMode: "source",
          dependencies: {},
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
  };
}

async function withInferredDeployEnv<T>(
  projectDir: string,
  fn: (context: { commitSha: string; sourceDigest: string }) => Promise<T>,
): Promise<T> {
  const envKeys = [
    // This fixture commits a repository of its own under a temp directory, so
    // a CI job's GITHUB_SHA names an unrelated commit; resolveGitSource fails
    // closed when it disagrees with HEAD.
    "GITHUB_SHA",
    "VERYFRONT_API_TOKEN",
    "VERYFRONT_API_URL",
    "VERYFRONT_PROJECT_SLUG",
    "VERYFRONT_PROJECT_ID",
  ];
  const savedEnv = envKeys.map((key) => Deno.env.get(key));

  try {
    Deno.env.delete("GITHUB_SHA");
    await Deno.writeTextFile(`${projectDir}/.gitignore`, ".veryfront/\n");
    await Deno.writeTextFile(`${projectDir}/package.json`, '{"name":"missing-app"}\n');
    await Deno.writeTextFile(`${projectDir}/app.ts`, PUSHED_SOURCE);
    const commitSha = await commitProject(projectDir);
    const sourceDigest = await computeSourceDigest([
      { path: "app.ts", content: PUSHED_SOURCE },
      { path: "package.json", content: '{"name":"missing-app"}\n' },
    ]);

    Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
    Deno.env.set("VERYFRONT_API_URL", "https://control.example.test/api");
    Deno.env.delete("VERYFRONT_PROJECT_SLUG");
    Deno.env.delete("VERYFRONT_PROJECT_ID");
    _resetEnvironmentConfig();

    return await fn({ commitSha, sourceDigest });
  } finally {
    envKeys.forEach((key, index) => {
      const value = savedEnv[index];
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    });
    _resetEnvironmentConfig();
    setJsonMode(false);
    setVerboseMode(false);
    await Deno.remove(projectDir, { recursive: true });
  }
}

async function expectDeployReceiptError(
  operation: () => Promise<unknown>,
  jsonMode: boolean,
  output: string[],
  forbiddenText: string,
): Promise<void> {
  if (!jsonMode) {
    const error = await assertRejects(
      operation,
      Error,
      "orphaned",
    );
    assertEquals(String(error).includes(forbiddenText), false);
    return;
  }

  const originalExit = Deno.exit;
  try {
    Deno.exit = ((code?: number): never => {
      throw new Error(`Deno.exit(${code ?? 0})`);
    }) as typeof Deno.exit;
    await assertRejects(operation, Error, "Deno.exit(1)");
  } finally {
    Deno.exit = originalExit;
  }

  const result = output.map((line) => JSON.parse(line)).at(-1);
  assertEquals(result.success, false);
  assertEquals(result.error.includes("orphaned"), true);
  assertEquals(result.error.includes(forbiddenText), false);
  assertEquals(result.errorDetails.message, result.error);
  assertEquals(typeof result.errorDetails.slug, "string");
}

it("deploys production from the existing verified push without mutating source", async () => {
  for (const jsonMode of [false, true]) {
    const projectDir = await Deno.makeTempDir();
    await withDeployEnv(projectDir, async ({ commitSha, sourceDigest }) => {
      await writePushReceipt(projectDir, {
        controlPlane: "https://control.example.test/api",
        projectId: PROJECT_ID,
        projectSlug: "my-project",
        branch: "feature-x",
        commitSha,
        sourceDigest,
        clean: true,
        pushedAt: "2026-07-10T09:20:00.000Z",
      });

      const requests: string[] = [];
      const uploadedPaths: string[] = [];
      const branchCreates: string[] = [];
      const output: string[] = [];
      const originalLog = console.log;
      setJsonMode(jsonMode);
      console.log = (...args: unknown[]) => {
        output.push(args.map(String).join(" "));
      };

      try {
        await withMockFetch(
          createDeployFetchHandler({ requests, sourceDigest, uploadedPaths, branchCreates }),
          () =>
            deployCommand({
              projectDir,
              branch: "feature-x",
              env: "production",
              dryRun: false,
              force: false,
              quiet: true,
              deployProject: boundedDeployProject(),
            }),
        );
      } finally {
        console.log = originalLog;
      }

      assertEquals(uploadedPaths, []);
      assertEquals(branchCreates, []);
      assertEquals(
        requests.some((request) => request.startsWith("PUT ")),
        false,
      );
      assertEquals(
        requests.includes(`POST /api/projects/${PROJECT_ID}/deployments`),
        true,
      );

      if (jsonMode) {
        const result = output.map((line) => JSON.parse(line)).at(-1);
        assertEquals(result.data.branch, "feature-x");
        assertEquals(result.data.sourceDigest, sourceDigest);
      }
    });
  }
});

it("re-pushes uncommitted work instead of redeploying the source it replaced", async () => {
  // An edit that never reaches a commit leaves HEAD matching the receipt, so
  // no commit check can see it. veryfront up used to take the receipt's word
  // and serve the previous upload while reporting the edited source as live.
  // This drives the refreshing source `up` asks for, end to end: the refresh
  // push, the targeted prune of a file this checkout deleted, and the release
  // built from the resulting remote tree.
  const projectDir = await makeTempDir();
  const STUDIO_SOURCE = "export default function StudioPage() { return null; }\n";
  const LEGACY_SOURCE = "export const legacy = true;\n";
  await withDeployEnv(projectDir, async ({ commitSha, sourceDigest }) => {
    await writePushReceipt(projectDir, {
      controlPlane: "https://control.example.test/api",
      projectId: PROJECT_ID,
      projectSlug: "my-project",
      branch: "main",
      commitSha,
      sourceDigest,
      clean: true,
      pushedAt: "2026-07-10T09:20:00.000Z",
    });
    await writeSyncTarget(projectDir, {
      controlPlane: "https://control.example.test/api",
      projectId: PROJECT_ID,
      projectSlug: "my-project",
      branch: "main",
      files: {
        "legacy.ts": {
          digest: await computeContentDigest(LEGACY_SOURCE),
          versionId: remoteVersionId("legacy.ts"),
        },
      },
    });
    await Deno.writeTextFile(`${projectDir}/app.ts`, STALE_SOURCE);
    // A tracked file deleted here must be pruned from the branch; a remote-only
    // file nobody deleted must survive.

    const requests: string[] = [];
    const uploadedPaths: string[] = [];
    const deletedPaths: string[] = [];
    const uploadedFiles = new Map<string, string>([
      ["legacy.ts", LEGACY_SOURCE],
      ["studio-page.tsx", STUDIO_SOURCE],
    ]);
    const refreshedSourceDigest = await computeSourceDigest([
      { path: "app.ts", content: STALE_SOURCE },
      { path: "veryfront.json", content: '{"projectSlug":"my-project"}\n' },
      { path: "studio-page.tsx", content: STUDIO_SOURCE },
    ]);
    let pushStarted = false;
    let deletedDuringPush = false;

    await withMockFetch(
      createDeployFetchHandler({
        requests,
        sourceDigest: refreshedSourceDigest,
        uploadedPaths,
        uploadedFiles,
        deletedPaths,
        releaseFiles: uploadedFiles,
        releaseSource: STALE_SOURCE,
        async onRequest() {
          if (!pushStarted || deletedDuringPush) return;
          deletedDuringPush = true;
          await Deno.remove(`${projectDir}/legacy.ts`);
        },
      }),
      () =>
        boundedDeployProject().execute({
          projectDir,
          branch: "main",
          environment: "production",
          mode: "apply",
          source: { kind: "ensure-pushed", refreshStaleSource: true },
        }, {
          onEvent(event) {
            if (
              event.kind === "step" && event.step === "push-source" && event.phase === "started"
            ) {
              pushStarted = true;
            }
          },
        }),
    );

    assertEquals(uploadedPaths.includes("app.ts"), true);
    assertEquals(uploadedFiles.get("app.ts"), STALE_SOURCE);
    assertEquals(deletedPaths, ["legacy.ts"]);
    assertEquals(uploadedFiles.get("studio-page.tsx"), STUDIO_SOURCE);
    assertEquals(
      requests.includes(`POST /api/projects/${PROJECT_ID}/deployments`),
      true,
    );
  }, { "legacy.ts": LEGACY_SOURCE });
});

it("refreshes changed digest-only source outside Git", async () => {
  const projectDir = await makeTempDir();
  await withDeployEnv(projectDir, async ({ sourceDigest }) => {
    await Deno.remove(`${projectDir}/.git`, { recursive: true });
    Deno.env.delete("GITHUB_SHA");
    await writePushReceipt(projectDir, {
      controlPlane: "https://control.example.test/api",
      projectId: PROJECT_ID,
      projectSlug: "my-project",
      branch: "main",
      commitSha: null,
      sourceDigest,
      localSourceDigest: sourceDigest,
      clean: false,
      pushedAt: "2026-07-10T09:20:00.000Z",
    });
    await writeSyncTarget(projectDir, {
      controlPlane: "https://control.example.test/api",
      projectId: PROJECT_ID,
      projectSlug: "my-project",
      branch: "main",
      files: {
        "app.ts": {
          digest: await computeContentDigest(PUSHED_SOURCE),
          versionId: remoteVersionId("app.ts"),
        },
        "veryfront.json": {
          digest: await computeContentDigest('{"projectSlug":"my-project"}\n'),
          versionId: remoteVersionId("veryfront.json"),
        },
      },
    });
    await Deno.writeTextFile(`${projectDir}/app.ts`, STALE_SOURCE);

    const requests: string[] = [];
    const uploadedFiles = new Map<string, string>([
      ["app.ts", PUSHED_SOURCE],
      ["veryfront.json", '{"projectSlug":"my-project"}\n'],
    ]);
    const refreshedSourceDigest = await computeSourceDigest([
      { path: "app.ts", content: STALE_SOURCE },
      { path: "veryfront.json", content: '{"projectSlug":"my-project"}\n' },
    ]);

    await withMockFetch(
      createDeployFetchHandler({
        requests,
        sourceDigest: refreshedSourceDigest,
        uploadedFiles,
        releaseFiles: uploadedFiles,
        releaseSource: STALE_SOURCE,
      }),
      () =>
        boundedDeployProject().execute({
          projectDir,
          branch: "main",
          environment: "production",
          mode: "apply",
          source: { kind: "ensure-pushed", refreshStaleSource: true },
        }),
    );

    assertEquals(uploadedFiles.get("app.ts"), STALE_SOURCE);
    assertEquals(requests.includes(`POST /api/projects/${PROJECT_ID}/deployments`), true);
  });
});

it("refuses to promote a receipt the working tree no longer matches", async () => {
  // veryfront deploy promotes a reviewed push, and CI runs it after an
  // explicit veryfront push. An accidentally dirty checkout must fail rather
  // than upload unreviewed bytes to an environment.
  const projectDir = await makeTempDir();
  await withDeployEnv(projectDir, async ({ commitSha, sourceDigest }) => {
    await writePushReceipt(projectDir, {
      controlPlane: "https://control.example.test/api",
      projectId: PROJECT_ID,
      projectSlug: "my-project",
      branch: "main",
      commitSha,
      sourceDigest,
      clean: true,
      pushedAt: "2026-07-10T09:20:00.000Z",
    });
    await Deno.writeTextFile(`${projectDir}/app.ts`, STALE_SOURCE);

    const requests: string[] = [];
    const uploadedPaths: string[] = [];

    await assertRejects(
      () =>
        withMockFetch(
          createDeployFetchHandler({ requests, sourceDigest, uploadedPaths }),
          () =>
            deployCommand({
              projectDir,
              branch: "main",
              env: "production",
              dryRun: false,
              force: false,
              quiet: true,
              deployProject: boundedDeployProject(),
            }),
        ),
      Error,
      "uncommitted changes",
    );

    assertEquals(uploadedPaths, []);
    assertEquals(
      requests.includes(`POST /api/projects/${PROJECT_ID}/deployments`),
      false,
    );
  });
});

it("promotes the recorded push from a dirty worktree when deploy names a project", async () => {
  // Naming a project promotes what that project already has and never uploads
  // this directory, so a local edit is not evidence about the pushed source and
  // must neither be promoted nor refuse the promotion. Only the deploy that
  // owns the local source refreshes it.
  const projectDir = await makeTempDir();
  await withDeployEnv(projectDir, async ({ commitSha, sourceDigest }) => {
    await writePushReceipt(projectDir, {
      controlPlane: "https://control.example.test/api",
      projectId: PROJECT_ID,
      projectSlug: "my-project",
      branch: "main",
      commitSha,
      sourceDigest,
      clean: true,
      pushedAt: "2026-07-10T09:20:00.000Z",
    });
    await Deno.writeTextFile(`${projectDir}/app.ts`, STALE_SOURCE);

    const requests: string[] = [];
    const uploadedPaths: string[] = [];

    await withMockFetch(
      createDeployFetchHandler({ requests, sourceDigest, uploadedPaths }),
      () =>
        deployCommand({
          projectSlug: "my-project",
          projectDir,
          branch: "main",
          env: "production",
          dryRun: false,
          force: false,
          quiet: true,
          deployProject: boundedDeployProject(),
        }),
    );

    assertEquals(uploadedPaths, []);
    assertEquals(requests.some((request) => request.startsWith("PUT ")), false);
    assertEquals(
      requests.includes(`POST /api/projects/${PROJECT_ID}/deployments`),
      true,
    );
  });
});

it("defaults omitted deploy branch to main instead of promoting a feature push receipt", async () => {
  for (const jsonMode of [false, true]) {
    const projectDir = await Deno.makeTempDir();
    await withDeployEnv(projectDir, async ({ commitSha, sourceDigest }) => {
      await writePushReceipt(projectDir, {
        controlPlane: "https://control.example.test/api",
        projectId: PROJECT_ID,
        projectSlug: "my-project",
        branch: "feature-x",
        commitSha,
        sourceDigest,
        clean: true,
        pushedAt: "2026-07-10T09:20:00.000Z",
      });

      const requests: string[] = [];
      const output: string[] = [];
      const originalLog = console.log;
      setJsonMode(jsonMode);
      console.log = (...args: unknown[]) => {
        output.push(args.map(String).join(" "));
      };

      try {
        if (jsonMode) {
          const originalExit = Deno.exit;
          try {
            Deno.exit = ((code?: number): never => {
              throw new Error(`Deno.exit(${code ?? 0})`);
            }) as typeof Deno.exit;
            await assertRejects(
              () =>
                withMockFetch(
                  createDeployFetchHandler({ requests, sourceDigest }),
                  () =>
                    deployCommand({
                      projectDir,
                      env: "production",
                      dryRun: false,
                      force: false,
                      quiet: true,
                      deployProject: boundedDeployProject(),
                    }),
                ),
              Error,
              "Deno.exit(1)",
            );
          } finally {
            Deno.exit = originalExit;
          }

          const jsonResult = output.map((line) => JSON.parse(line)).at(-1);
          assertEquals(
            jsonResult.error.includes(
              'The latest push is for branch "feature-x", but deploy targets "main".',
            ),
            true,
          );
        } else {
          await assertRejects(
            () =>
              withMockFetch(
                createDeployFetchHandler({ requests, sourceDigest }),
                () =>
                  deployCommand({
                    projectDir,
                    env: "production",
                    dryRun: false,
                    force: false,
                    quiet: true,
                    deployProject: boundedDeployProject(),
                  }),
              ),
            Error,
            'The latest push is for branch "feature-x", but deploy targets "main".',
          );
        }
      } finally {
        console.log = originalLog;
      }

      assertEquals(
        requests.includes(`POST /api/projects/${PROJECT_ID}/deployments`),
        false,
      );
    });
  }
});

it("keeps an explicitly selected deploy branch strict", async () => {
  const projectDir = await Deno.makeTempDir();
  await withDeployEnv(projectDir, async ({ commitSha, sourceDigest }) => {
    await writePushReceipt(projectDir, {
      controlPlane: "https://control.example.test/api",
      projectId: PROJECT_ID,
      projectSlug: "my-project",
      branch: "feature-x",
      commitSha,
      sourceDigest,
      clean: true,
      pushedAt: "2026-07-10T09:20:00.000Z",
    });

    const requests: string[] = [];
    await assertRejects(
      () =>
        withMockFetch(
          createDeployFetchHandler({ requests, sourceDigest }),
          () =>
            deployCommand({
              projectDir,
              branch: "main",
              env: "production",
              dryRun: false,
              force: false,
              quiet: true,
              deployProject: boundedDeployProject(),
            }),
        ),
      Error,
      'The latest push is for branch "feature-x", but deploy targets "main".',
    );

    assertEquals(
      requests.includes(`POST /api/projects/${PROJECT_ID}/releases`),
      false,
    );
  });
});

it("fails inferred deploys with an orphaned receipt before creating remote or local state", async () => {
  for (const jsonMode of [false, true]) {
    for (const dryRun of [true, false]) {
      const projectDir = await Deno.makeTempDir();
      await withInferredDeployEnv(projectDir, async ({ commitSha, sourceDigest }) => {
        await writePushReceipt(projectDir, {
          controlPlane: "https://control.example.test/api",
          projectId: PROJECT_ID,
          projectSlug: "orphaned-project",
          branch: "main",
          commitSha,
          sourceDigest,
          clean: true,
          pushedAt: "2026-07-10T09:20:00.000Z",
        });

        const requests: string[] = [];
        const output: string[] = [];
        const originalLog = console.log;
        setJsonMode(jsonMode);
        console.log = (...args: unknown[]) => {
          output.push(args.map(String).join(" "));
        };

        try {
          await withMockFetch(async (input: string | URL | Request, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);
            const url = new URL(request.url);
            requests.push(`${request.method} ${url.pathname}`);
            return Response.json({ message: "not found" }, { status: 404 });
          }, () =>
            expectDeployReceiptError(
              () =>
                deployCommand({
                  projectDir,
                  branch: "main",
                  env: "production",
                  dryRun,
                  force: false,
                  quiet: true,
                }),
              jsonMode,
              output,
              projectDir,
            ));
        } finally {
          console.log = originalLog;
        }

        assertEquals(requests.some((request) => request.startsWith("POST ")), false);
        assertEquals(requests.some((request) => request.startsWith("PUT ")), false);
        assertEquals(await readProjectLink(projectDir), null);
      });
    }
  }
});

it("bootstraps exactly one quiet push when no verified push receipt exists", async () => {
  const projectDir = await Deno.makeTempDir();
  await withDeployEnv(projectDir, async ({ sourceDigest }) => {
    const requests: string[] = [];
    const uploadedPaths: string[] = [];

    await withMockFetch(
      createDeployFetchHandler({ requests, sourceDigest, uploadedPaths }),
      () =>
        deployCommand({
          projectDir,
          branch: "main",
          env: "production",
          dryRun: false,
          force: false,
          quiet: true,
          deployProject: boundedDeployProject(),
        }),
    );

    assertEquals(uploadedPaths.toSorted(), ["app.ts", "veryfront.json"]);
    assertEquals(
      requests.filter((request) => request.endsWith("/files/app.ts")).length,
      1,
    );
    assertEquals(
      requests.includes(`POST /api/projects/${PROJECT_ID}/deployments`),
      true,
    );
  });
});

it("never uploads the working directory when deploy names a project", async () => {
  const projectDir = await Deno.makeTempDir();
  await withDeployEnv(projectDir, async ({ sourceDigest }) => {
    const requests: string[] = [];
    const uploadedPaths: string[] = [];

    await withMockFetch(
      createDeployFetchHandler({ requests, sourceDigest, uploadedPaths }),
      () =>
        assertRejects(
          () =>
            deployCommand({
              projectSlug: "my-project",
              projectDir,
              branch: "main",
              env: "production",
              dryRun: false,
              force: false,
              quiet: true,
              deployProject: boundedDeployProject(),
            }),
          Error,
          'No verified push found for branch "main"',
        ),
    );

    assertEquals(uploadedPaths, []);
    assertEquals(requests.some((request) => request.startsWith("PUT ")), false);
    assertEquals(requests.includes(`POST /api/projects/${PROJECT_ID}/deployments`), false);
  });
});

it("refuses to deploy a project this directory did not push", async () => {
  // The incident this flag exists for: standing in one project's directory and
  // naming another. The receipt here is valid -- for `my-project` -- so nothing
  // but the slug mismatch can stop the deploy, and nothing may be uploaded on
  // the way to stopping it.
  const projectDir = await Deno.makeTempDir();
  await withDeployEnv(projectDir, async ({ sourceDigest }) => {
    await writePushReceipt(projectDir, {
      controlPlane: "https://control.example.test/api",
      projectId: PROJECT_ID,
      projectSlug: "my-project",
      branch: "main",
      commitSha: `${"2".repeat(40)}`,
      sourceDigest,
      clean: true,
      pushedAt: "2026-07-10T09:20:00.000Z",
    });

    const requests: string[] = [];
    const uploadedPaths: string[] = [];

    await withMockFetch(
      createDeployFetchHandler({ requests, sourceDigest, uploadedPaths }),
      () =>
        assertRejects(
          () =>
            deployCommand({
              projectSlug: OTHER_PROJECT_SLUG,
              projectDir,
              branch: "main",
              env: "production",
              dryRun: false,
              force: false,
              quiet: true,
              deployProject: boundedDeployProject(),
            }),
          Error,
          "The latest push targeted a different project.",
        ),
    );

    assertEquals(uploadedPaths, [], "a named project must never receive this directory");
    assertEquals(requests.some((request) => request.startsWith("PUT ")), false);
    assertEquals(requests.includes(`POST /api/projects/${PROJECT_ID}/deployments`), false);
  });
});

it("refuses the same mismatch in a dry run as in an apply", async () => {
  // A dry run is read in order to trust the apply that follows. Naming a
  // project makes the source already-pushed, which used to skip the receipt
  // check here -- so the dry run reported a deploy the identical apply refused.
  const projectDir = await Deno.makeTempDir();
  await withDeployEnv(projectDir, async ({ sourceDigest }) => {
    await writePushReceipt(projectDir, {
      controlPlane: "https://control.example.test/api",
      projectId: PROJECT_ID,
      projectSlug: "my-project",
      branch: "main",
      commitSha: `${"3".repeat(40)}`,
      sourceDigest,
      clean: true,
      pushedAt: "2026-07-10T09:20:00.000Z",
    });

    const requests: string[] = [];
    const uploadedPaths: string[] = [];

    await withMockFetch(
      createDeployFetchHandler({ requests, sourceDigest, uploadedPaths }),
      () =>
        assertRejects(
          () =>
            deployCommand({
              projectSlug: OTHER_PROJECT_SLUG,
              projectDir,
              branch: "main",
              env: "production",
              dryRun: true,
              force: false,
              quiet: true,
              deployProject: boundedDeployProject(),
            }),
          Error,
          "The latest push targeted a different project.",
        ),
    );

    assertEquals(uploadedPaths, [], "a dry run must not upload either");
  });
});

it("fails on a stale verified push receipt instead of replacing it", async () => {
  const projectDir = await Deno.makeTempDir();
  await withDeployEnv(projectDir, async ({ sourceDigest }) => {
    await writePushReceipt(projectDir, {
      controlPlane: "https://control.example.test/api",
      projectId: PROJECT_ID,
      projectSlug: "my-project",
      branch: "main",
      commitSha: `${"1".repeat(40)}`,
      sourceDigest,
      clean: true,
      pushedAt: "2026-07-10T09:20:00.000Z",
    });

    const requests: string[] = [];
    const uploadedPaths: string[] = [];

    await withMockFetch(
      createDeployFetchHandler({ requests, sourceDigest, uploadedPaths }),
      () =>
        assertRejects(
          () =>
            deployCommand({
              projectDir,
              branch: "main",
              env: "production",
              dryRun: true,
              force: false,
              quiet: true,
            }),
          Error,
          "The latest push came from a different commit. Run veryfront push again.",
        ),
    );
    await withMockFetch(
      createDeployFetchHandler({ requests, sourceDigest, uploadedPaths }),
      () =>
        assertRejects(
          () =>
            deployCommand({
              projectDir,
              branch: "main",
              env: "production",
              dryRun: false,
              force: false,
              quiet: true,
            }),
          Error,
          "The latest push came from a different commit. Run veryfront push again.",
        ),
    );

    assertEquals(uploadedPaths, []);
    assertEquals(
      requests.some((request) => request.startsWith("PUT ")),
      false,
    );
    assertEquals(
      requests.includes(`POST /api/projects/${PROJECT_ID}/deployments`),
      false,
    );
  });
});

it("reports dry-run deploy actions from the verified push state in human and JSON modes", async () => {
  for (const jsonMode of [false, true]) {
    const projectDir = await Deno.makeTempDir();
    await withDeployEnv(projectDir, async ({ commitSha, sourceDigest }) => {
      await writePushReceipt(projectDir, {
        controlPlane: "https://control.example.test/api",
        projectId: PROJECT_ID,
        projectSlug: "my-project",
        branch: "main",
        commitSha,
        sourceDigest,
        clean: true,
        pushedAt: "2026-07-10T09:20:00.000Z",
      });

      const requests: string[] = [];
      const output: string[] = [];
      const originalLog = console.log;
      setJsonMode(jsonMode);
      console.log = (...args: unknown[]) => {
        output.push(args.map(String).join(" "));
      };

      try {
        await withMockFetch(
          createDeployFetchHandler({ requests, sourceDigest }),
          () =>
            deployCommand({
              projectDir,
              branch: "main",
              env: "production",
              dryRun: true,
              force: false,
              quiet: false,
            }),
        );
      } finally {
        console.log = originalLog;
      }

      if (jsonMode) {
        const result = output.map((line) => JSON.parse(line)).at(-1);
        assertEquals(result.data.plannedActions, ["create-release", "deploy"]);
      } else {
        const humanOutput = stripAnsi(output.join("\n"));
        assertEquals(
          humanOutput.includes('Would create release and deploy to "production"'),
          true,
        );
        assertEquals(humanOutput.includes("push source"), false);
      }
    });
  }
});

it("uses canonical production read-back in human and JSON modes", async () => {
  const projectDir = await Deno.makeTempDir();
  // GITHUB_SHA is cleared for the same reason as in withDeployEnv: this
  // fixture's Git repository is not the one a CI job is checked out on.
  const envKeys = [
    "GITHUB_SHA",
    "VERYFRONT_API_TOKEN",
    "VERYFRONT_API_URL",
    "VERYFRONT_PROJECT_SLUG",
  ];
  const savedEnv = envKeys.map((key) => Deno.env.get(key));
  const requests: string[] = [];
  let environmentReads = 0;
  let environmentUrlReads = 0;

  try {
    Deno.env.delete("GITHUB_SHA");
    const currentReleaseSource = "export default function Dashboard() { return null; }\n";
    await Deno.mkdir(`${projectDir}/pages`, { recursive: true });
    await Deno.writeTextFile(`${projectDir}/.gitignore`, ".veryfront/\n");
    await Deno.writeTextFile(`${projectDir}/veryfront.json`, '{"projectSlug":"my-project"}\n');
    await Deno.writeTextFile(`${projectDir}/pages/dashboard.tsx`, currentReleaseSource);
    const actualSha = await commitProject(projectDir);
    const sourceDigest = await computeSourceDigest([
      { path: "pages/dashboard.tsx", content: currentReleaseSource },
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

      if (
        request.method === "GET" &&
        url.hostname === "my-project.production.veryfront.com"
      ) {
        environmentUrlReads++;
        return new Response(environmentUrlReads === 1 ? "not ready" : "ready", {
          status: environmentUrlReads === 1 ? 404 : 200,
        });
      }
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
            schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
            projectId: PROJECT_ID,
            releaseId: RELEASE_ID,
            releaseVersion: 41,
            manifestVersion: 1,
            builderVersion: "test",
            sourceContentHash: sourceDigest.slice("sha256:".length),
            createdAt: "2026-07-10T09:20:00.000Z",
            assetBasePath: "/_vf/assets",
            modules: {
              "pages/dashboard.tsx": {
                contentHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                size: 10,
                contentType: "text/javascript",
              },
            },
            css: [],
            routes: {
              "/dashboard": {
                modules: ["pages/dashboard.tsx"],
                css: [],
              },
            },
            dependencyMode: "source",
            dependencies: {},
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
            path: "pages/dashboard.tsx",
            data: JSON.stringify({
              body: releaseSourceContents?.shift() ?? currentReleaseSource,
              path: "pages/dashboard.tsx",
            }),
          }],
          page_info: {},
        });
      }
      return Response.json({ message: "not found" }, { status: 404 });
    };

    const runDeploy = (quiet = true) =>
      deployCommand({
        projectDir,
        branch: "main",
        env: "production",
        releaseName: `github-main-${actualSha}`,
        dryRun: false,
        force: false,
        quiet,
        skipSourcePush: true,
        deployProject: boundedDeployProject(),
      });

    const outputModes = [
      { json: false, verbose: false },
      { json: false, verbose: true },
      { json: true, verbose: false },
    ];
    const adapterResults: Array<{ json: boolean; verbose: boolean; result: unknown }> = [];
    for (const outputMode of outputModes) {
      const { json: jsonMode, verbose } = outputMode;
      setJsonMode(jsonMode);
      setVerboseMode(verbose);
      requests.length = 0;
      environmentReads = 0;
      environmentUrlReads = 0;
      releaseSourceReads = 0;
      releaseSourceContents = ["export const value = 0;\n", currentReleaseSource];
      const output: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        output.push(args.map(String).join(" "));
      };

      let result;
      try {
        result = await withMockFetch(handleRequest, () => runDeploy(jsonMode));
      } finally {
        console.log = originalLog;
      }

      assertEquals(result?.projectSlug, "my-project");
      assertEquals(
        result?.url,
        "https://my-project.production.veryfront.com/dashboard",
      );
      adapterResults.push({ json: jsonMode, verbose, result });
      assertEquals(environmentReads, 2);
      assertEquals(environmentUrlReads, 2);
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
        // The environment is protected and the credential is an API key, so
        // deploy asks for a token bound to this environment before probing.
        "POST /api/auth/environment-token",
        "GET /dashboard",
        "GET /dashboard",
      ]);
      if (jsonMode) {
        const events = output.map((line) =>
          JSON.parse(line) as {
            type: string;
            name?: string;
            status?: string;
            data?: { url?: string };
          }
        );
        assertEquals(
          events
            .filter((event) => event.type === "step" && event.status === "completed")
            .map((event) => event.name),
          [
            "resolve-config",
            "resolve-target",
            "verify-source",
            "create-release",
            "verify-release-source",
            "wait-release-assets",
            "deploy",
            "verify-deployment",
            "wait-environment-url",
          ],
        );
        assertEquals(
          events.slice(-4).map((event) =>
            event.type === "step" ? `${event.name}:${event.status}` : event.type
          ),
          [
            "verify-deployment:completed",
            "wait-environment-url:started",
            "wait-environment-url:completed",
            "result",
          ],
        );
        assertEquals(
          events.at(-1)?.data?.url,
          "https://my-project.production.veryfront.com/dashboard",
        );
      } else if (!verbose) {
        const humanOutput = stripAnsi(output.join("\n"));
        const humanLines = humanOutput.split("\n").map((line) => line.trim()).filter(Boolean);
        assertEquals(humanOutput.includes("✓ Deployed my-project to production"), true);
        assertEquals(
          humanLines[1],
          "https://my-project.production.veryfront.com/dashboard",
        );
        assertEquals(humanOutput.includes("Protected"), true);
        assertEquals(humanOutput.includes("Release 0.0.41"), true);
        assertEquals(humanOutput.includes("Project:"), false);
        assertEquals(humanOutput.includes("Environment:"), false);
        assertEquals(humanOutput.includes("Deployment:"), false);
        assertEquals(humanOutput.includes("Source digest:"), false);
        assertEquals(humanOutput.includes("Control plane:"), false);
        assertEquals(humanOutput.includes("Using local filesystem"), false);
        assertEquals(humanOutput.includes("Next steps:"), false);
      } else {
        const verboseOutput = stripAnsi(output.join("\n"));
        assertEquals(verboseOutput.includes(`Project: my-project (${PROJECT_ID})`), true);
        assertEquals(
          verboseOutput.includes(`Environment: production (${ENVIRONMENT_ID})`),
          true,
        );
        assertEquals(verboseOutput.includes(`Deployment: ${DEPLOYMENT_ID}`), true);
        assertEquals(verboseOutput.includes(`Source digest: ${sourceDigest}`), true);
        assertEquals(
          verboseOutput.includes("Control plane: https://control.example.test/api"),
          true,
        );
        assertEquals(verboseOutput.includes("veryfront open"), true);
        assertEquals(verboseOutput.includes("npx"), false);
      }
    }
    const humanResult = adapterResults.find((entry) => !entry.json && !entry.verbose)?.result;
    const jsonResult = adapterResults.find((entry) => entry.json)?.result;
    assertEquals(jsonResult, humanResult);

    setJsonMode(false);
    setVerboseMode(false);
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
      let deploymentSettled = false;
      const deploymentError = deployment.then(
        () => undefined,
        (error: unknown) => error,
      ).finally(() => {
        deploymentSettled = true;
      });

      resumeReleaseSourceRead();
      await time.tickAsync(0);
      for (
        let tick = 0;
        // The deploy flow now does more pre-mutation verification before this
        // poll starts. Keep the read budget fixed at 20, but allow enough fake
        // clock ticks for the async chain to issue all reads under load.
        !deploymentSettled && tick < 60;
        tick++
      ) {
        await time.tickAsync(500);
      }
      for (let tick = 0; !deploymentSettled && tick < 10; tick++) {
        await time.tickAsync(0);
      }
      assertEquals(
        deploymentSettled,
        true,
        "release-source polling did not settle inside its fixed read budget",
      );
      const error = await deploymentError;
      assertEquals(error instanceof Error, true);
      assertEquals(
        String(error).includes("does not match pushed commit"),
        true,
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
    setVerboseMode(false);
    await Deno.remove(projectDir, { recursive: true });
  }
});

it("deploys production from a dirty worktree when the pushed digest matches the release", async () => {
  const projectDir = await Deno.makeTempDir();
  const envKeys = [
    "GITHUB_SHA",
    "VERYFRONT_API_TOKEN",
    "VERYFRONT_API_URL",
    "VERYFRONT_PROJECT_SLUG",
  ];
  const savedEnv = envKeys.map((key) => Deno.env.get(key));
  const releaseSource = "export default function Dashboard() { return null; }\n";
  const requests: string[] = [];

  try {
    Deno.env.delete("GITHUB_SHA");
    await Deno.mkdir(`${projectDir}/pages`, { recursive: true });
    await Deno.writeTextFile(`${projectDir}/.gitignore`, ".veryfront/\n");
    await Deno.writeTextFile(`${projectDir}/veryfront.json`, '{"projectSlug":"my-project"}\n');
    await Deno.writeTextFile(`${projectDir}/pages/dashboard.tsx`, releaseSource);
    const actualSha = await commitProject(projectDir);
    const sourceDigest = await computeSourceDigest([
      { path: "pages/dashboard.tsx", content: releaseSource },
    ]);
    await writePushReceipt(projectDir, {
      controlPlane: "https://control.example.test/api",
      projectId: PROJECT_ID,
      projectSlug: "my-project",
      branch: "main",
      commitSha: actualSha,
      sourceDigest,
      clean: false,
      pushedAt: "2026-07-10T09:20:00.000Z",
    });
    await Deno.writeTextFile(
      `${projectDir}/pages/dashboard.tsx`,
      "export default function Dashboard() { return 'local draft'; }\n",
    );

    Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
    Deno.env.set("VERYFRONT_API_URL", "https://control.example.test/api");
    Deno.env.set("VERYFRONT_PROJECT_SLUG", "my-project");
    _resetEnvironmentConfig();

    await withMockFetch(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}`);

      if (request.method === "GET" && url.pathname === "/api/projects/my-project") {
        return Response.json({ id: PROJECT_ID, slug: "my-project" });
      }
      if (request.method === "GET" && url.pathname.endsWith("/environments")) {
        return Response.json({
          data: [{
            id: ENVIRONMENT_ID,
            name: "production",
            project_id: PROJECT_ID,
            protected: true,
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
            path: "pages/dashboard.tsx",
            data: JSON.stringify({ body: releaseSource, path: "pages/dashboard.tsx" }),
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
            schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
            projectId: PROJECT_ID,
            releaseId: RELEASE_ID,
            releaseVersion: 41,
            manifestVersion: 1,
            builderVersion: "test",
            sourceContentHash: sourceDigest.slice("sha256:".length),
            createdAt: "2026-07-10T09:20:00.000Z",
            assetBasePath: "/_vf/assets",
            modules: {
              "pages/dashboard.tsx": {
                contentHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                size: 10,
                contentType: "text/javascript",
              },
            },
            css: [],
            routes: {
              "/dashboard": {
                modules: ["pages/dashboard.tsx"],
                css: [],
              },
            },
            dependencyMode: "source",
            dependencies: {},
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
      if (request.method === "GET" && url.pathname === "/dashboard") {
        return new Response("ready");
      }
      return Response.json({ message: "not found" }, { status: 404 });
    }, () =>
      deployCommand({
        projectDir,
        branch: "main",
        env: "production",
        releaseName: `github-main-${actualSha}`,
        dryRun: false,
        force: false,
        quiet: true,
        skipSourcePush: true,
        deployProject: boundedDeployProject(),
      }));

    assertEquals(
      requests.includes(`GET /api/projects/${PROJECT_ID}/releases/${RELEASE_ID}/versions`),
      true,
    );
    assertEquals(
      requests.includes(`POST /api/projects/${PROJECT_ID}/deployments`),
      true,
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

    assertEquals(requests, []);
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

it("does not rewrite an existing local project link during dry-run deploy", async () => {
  const projectDir = await Deno.makeTempDir();
  const envKeys = [
    "VERYFRONT_API_TOKEN",
    "VERYFRONT_API_URL",
    "VERYFRONT_PROJECT_SLUG",
    "VERYFRONT_PROJECT_ID",
  ];
  const savedEnv = envKeys.map((key) => Deno.env.get(key));

  try {
    Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
    Deno.env.set("VERYFRONT_API_URL", "https://control.example.test/api");
    for (const key of envKeys.slice(2)) Deno.env.delete(key);
    _resetEnvironmentConfig();

    await writeProjectLink(projectDir, {
      controlPlane: "https://control.example.test/api",
      projectId: PROJECT_ID,
      projectSlug: "stale-slug",
    });
    const linkPath = `${projectDir}/.veryfront/project.json`;
    const originalLink = await Deno.readTextFile(linkPath);

    await withMockFetch((input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === `/api/projects/${PROJECT_ID}`) {
        return Promise.resolve(Response.json({ id: PROJECT_ID, slug: "canonical-slug" }));
      }
      if (
        request.method === "GET" &&
        url.pathname === `/api/projects/${PROJECT_ID}/environments`
      ) {
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

      throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
    }, () =>
      deployCommand({
        projectDir,
        branch: "main",
        env: "production",
        dryRun: true,
        force: false,
        quiet: true,
        skipSourcePush: true,
      }));

    assertEquals(await Deno.readTextFile(linkPath), originalLink);
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
    // See withDeployEnv: the temp repository below is not the CI checkout.
    "GITHUB_SHA",
    "VERYFRONT_API_TOKEN",
    "VERYFRONT_API_URL",
    "VERYFRONT_PROJECT_SLUG",
    "VERYFRONT_PROJECT_ID",
  ];
  const savedEnv = envKeys.map((key) => Deno.env.get(key));
  const createSlugs: string[] = [];
  let environmentUrlReads = 0;
  let inferredProjectLookups = 0;

  try {
    Deno.env.delete("GITHUB_SHA");
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

      if (
        request.method === "GET" &&
        url.hostname.endsWith(".preview.veryfront.com")
      ) {
        environmentUrlReads++;
        return new Response("ready");
      }
      if (request.method === "GET" && url.pathname === "/api/projects/taken-app") {
        inferredProjectLookups++;
        return Response.json({ message: "not found" }, { status: 404 });
      }
      if (request.method === "POST" && url.pathname === "/api/projects") {
        const body = await request.json() as { slug: string };
        createSlugs.push(body.slug);
        if (body.slug === "taken-app") {
          return Response.json({ error: "taken" }, { status: 409 });
        }
        assertEquals(/^taken-app-[a-z0-9]{6}$/.test(body.slug), true);
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
            schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
            projectId: PROJECT_ID,
            releaseId: RELEASE_ID,
            releaseVersion: 41,
            manifestVersion: 1,
            builderVersion: "test",
            sourceContentHash: sourceDigest.slice("sha256:".length),
            createdAt: "2026-07-10T09:20:00.000Z",
            assetBasePath: "/_vf/assets",
            modules: {},
            css: [],
            routes: {},
            dependencyMode: "source",
            dependencies: {},
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
    assertEquals(inferredProjectLookups, 0);
    assertEquals(environmentUrlReads, 0);
    assertEquals(createSlugs[0], "taken-app");
    assertEquals(/^taken-app-[a-z0-9]{6}$/.test(createSlugs[1] ?? ""), true);
    const link = await readProjectLink(projectDir);
    assertEquals(link?.projectId, PROJECT_ID);
    assertEquals(link?.projectSlug, createSlugs[1]);
    await assertRejects(
      () => Deno.stat(`${projectDir}/veryfront.json`),
      Deno.errors.NotFound,
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

it("collects configured app and pages routes when projectDir has a trailing slash", async () => {
  const projectDir = await Deno.makeTempDir();
  const envKeys = [
    // See withDeployEnv: the temp repository below is not the CI checkout.
    "GITHUB_SHA",
    "VERYFRONT_API_TOKEN",
    "VERYFRONT_API_URL",
    "VERYFRONT_PROJECT_SLUG",
    "VERYFRONT_PROJECT_ID",
  ];
  const savedEnv = envKeys.map((key) => Deno.env.get(key));

  try {
    Deno.env.delete("GITHUB_SHA");
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
            schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
            projectId: PROJECT_ID,
            releaseId: RELEASE_ID,
            releaseVersion: 41,
            manifestVersion: 1,
            builderVersion: "test",
            sourceContentHash: sourceDigest.slice("sha256:".length),
            createdAt: "2026-07-10T09:20:00.000Z",
            assetBasePath: "/_vf/assets",
            modules: {},
            css: [],
            routes: {},
            dependencyMode: "source",
            dependencies: {},
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
