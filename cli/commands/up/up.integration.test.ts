import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { join, relative } from "#veryfront/compat/path/index.ts";
import {
  exists,
  makeTempDir,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/compat/fs.ts";
import { upCommand } from "./index.ts";
import { createDeployProject } from "../../shared/deployment/deploy-project.ts";
import type {
  DeployEnvironment,
  DeployReleaseFile,
} from "../../shared/deployment/control-plane.ts";
import {
  commitProject,
  CONTROL_PLANE,
  ENVIRONMENT_ID,
  InMemoryDeployControlPlane,
  PROJECT_ID,
  PROJECT_SLUG,
  withDeployEnv,
  withFetchStub,
} from "../../test-utils/deploy-test-support.ts";
import { computeSourceDigest, writePushReceipt } from "../../shared/deployment-provenance.ts";
import { writeProjectLink } from "../../shared/project-link.ts";
import { resetInteractiveMode, setNonInteractive } from "../../shared/interactive.ts";
import { setJsonMode } from "../../shared/json-output.ts";
import { stripAnsi } from "../../ui/ansi.ts";

function getSlug(dirName: string): string {
  return dirName.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
}

async function listDirNames(
  dir: string,
  options: { skipHidden?: boolean; skipNodeModules?: boolean } = {},
): Promise<string[]> {
  const { skipHidden = false, skipNodeModules = false } = options;
  const entries: string[] = [];

  for await (const entry of readDir(dir)) {
    if (skipHidden && entry.name.startsWith(".")) continue;
    if (skipNodeModules && entry.name === "node_modules") continue;
    entries.push(entry.name);
  }

  return entries;
}

describe("Up Command Integration", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await makeTempDir({ prefix: "vf-up-test-" });
  });

  afterEach(async () => {
    try {
      await remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Directory analysis", () => {
    it("should detect empty directory", async () => {
      const entries = await listDirNames(testDir, { skipHidden: true });
      assertEquals(entries.length, 0);
    });

    it("should detect directory with code (package.json)", async () => {
      await writeTextFile(join(testDir, "package.json"), "{}");

      const entries = await listDirNames(testDir);
      const hasCode = entries.some((name) =>
        name === "package.json" || name === "deno.json" || name.endsWith(".ts")
      );

      assertEquals(hasCode, true);
    });

    it("should detect directory with code (deno.json)", async () => {
      await writeTextFile(join(testDir, "deno.json"), "{}");

      const entries = await listDirNames(testDir);
      const hasCode = entries.includes("deno.json");

      assertEquals(hasCode, true);
    });

    it("should detect directory with TypeScript files", async () => {
      await writeTextFile(join(testDir, "index.ts"), "export const x = 1;");

      const entries = await listDirNames(testDir);
      const hasCode = entries.some((name) => name.endsWith(".ts"));

      assertEquals(hasCode, true);
    });

    it("should detect existing project (veryfront.json)", async () => {
      const config = { projectSlug: "my-app" };
      const configPath = join(testDir, "veryfront.json");

      await writeTextFile(configPath, JSON.stringify(config));

      assertEquals(await exists(configPath), true);

      const content = await readTextFile(configPath);
      const parsed = JSON.parse(content);

      assertEquals(parsed.projectSlug, "my-app");
    });

    it("should skip hidden files when checking for code", async () => {
      await writeTextFile(join(testDir, ".gitignore"), "node_modules");

      const entries = await listDirNames(testDir, { skipHidden: true });
      assertEquals(entries.length, 0);
    });

    it("should skip node_modules when checking for code", async () => {
      await mkdir(join(testDir, "node_modules"));
      await writeTextFile(join(testDir, "node_modules", "test.js"), "");

      const entries = await listDirNames(testDir, { skipHidden: true, skipNodeModules: true });
      assertEquals(entries.length, 0);
    });
  });

  describe("Project slug generation", () => {
    it("should sanitize directory name for slug", () => {
      assertEquals(getSlug("My Project 123"), "my-project-123");
    });

    it("should handle special characters", () => {
      assertEquals(getSlug("project@v2.0!test"), "project-v2-0-test");
    });

    it("should handle already valid slug", () => {
      assertEquals(getSlug("my-project"), "my-project");
    });
  });

  describe("Config file handling", () => {
    it("should save config file correctly", async () => {
      const config = { projectSlug: "test-project" };
      const configPath = join(testDir, "veryfront.json");

      await writeTextFile(configPath, JSON.stringify(config, null, 2) + "\n");

      const content = await readTextFile(configPath);
      const parsed = JSON.parse(content);

      assertEquals(parsed.projectSlug, "test-project");
    });

    it("should read config file correctly", async () => {
      const config = { projectSlug: "existing-project" };
      const configPath = join(testDir, "veryfront.json");

      await writeTextFile(configPath, JSON.stringify(config));

      const content = await readTextFile(configPath);
      const parsed = JSON.parse(content);

      assertEquals(parsed.projectSlug, "existing-project");
    });
  });
});

const PREVIEW_DOMAIN = "https://preview.example.test";
const APP_PAGE = "export default function Page() { return <main>Hello</main>; }\n";

/**
 * The in-memory control plane with a preview environment that carries its own
 * domain, and whose release mirrors whatever the bootstrap push uploaded.
 */
class PreviewControlPlane extends InMemoryDeployControlPlane {
  constructor(private readonly pushedFiles: Map<string, string>) {
    super();
  }

  override async getEnvironment(
    reference: string,
    name: string,
  ): Promise<DeployEnvironment | null> {
    const environment = await super.getEnvironment(reference, name);
    return environment ? { ...environment, domains: [PREVIEW_DOMAIN] } : environment;
  }

  override async *listReleaseFiles(
    _reference: string,
    _releaseId: string,
  ): AsyncIterable<DeployReleaseFile> {
    for (const [path, content] of this.pushedFiles) yield { path, content };
  }
}

interface UpRun {
  output: string[];
  controlPlane: PreviewControlPlane;
  projectCreates: number;
  uploadedPaths: string[];
  /** The message up rejected with, or null when the command completed. */
  failure: string | null;
}

interface UpRunOptions {
  dryRun?: boolean;
  jsonMode?: boolean;
  relativeProjectDir?: boolean;
  /**
   * Seed a linked project plus a push receipt for this branch, so the deploy
   * meets a receipt that does not describe the branch up targets.
   */
  receiptBranch?: string;
}

/**
 * Runs upCommand against the real Deploy Execution module: project creation,
 * the bootstrap push, and the readiness probe go over a fetch stub, releases
 * and deployments go through the in-memory control plane.
 */
async function runUp(options: UpRunOptions = {}): Promise<UpRun> {
  const { dryRun = false, jsonMode = false, receiptBranch, relativeProjectDir = false } = options;
  const projectDir = await makeTempDir({ prefix: "vf-up-e2e-" });
  const pushedFiles = new Map<string, string>();
  const controlPlane = new PreviewControlPlane(pushedFiles);
  const uploadedPaths: string[] = [];
  const output: string[] = [];
  const originalLog = console.log;
  let projectCreates = 0;
  let failure: string | null = null;

  try {
    await writeTextFile(join(projectDir, ".gitignore"), ".veryfront/\n");
    await writeTextFile(join(projectDir, "package.json"), `{"name":"${PROJECT_SLUG}"}\n`);
    await mkdir(join(projectDir, "app"));
    await writeTextFile(join(projectDir, "app", "page.tsx"), APP_PAGE);
    const commitSha = await commitProject(projectDir);

    if (receiptBranch) {
      await writeProjectLink(projectDir, {
        controlPlane: CONTROL_PLANE,
        projectId: PROJECT_ID,
        projectSlug: PROJECT_SLUG,
      });
      await writePushReceipt(projectDir, {
        controlPlane: CONTROL_PLANE,
        projectId: PROJECT_ID,
        projectSlug: PROJECT_SLUG,
        branch: receiptBranch,
        commitSha,
        // Well-formed but not this tree's pushed digest: the branch check
        // fires first, which is what this receipt is here to prove.
        sourceDigest: await computeSourceDigest([{ path: "app/page.tsx", content: APP_PAGE }]),
        clean: true,
      });
    }

    console.log = (...args: unknown[]) => output.push(args.map(String).join(" "));
    setNonInteractive(true);
    setJsonMode(jsonMode);

    const run = () =>
      withFetchStub(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);

        if (url.origin === PREVIEW_DOMAIN) return new Response("ready");
        if (url.pathname.endsWith("/me")) {
          return Response.json({ id: "user-1", email: "dev@example.com" });
        }
        if (request.method === "POST" && url.pathname === "/api/projects") {
          projectCreates++;
          return Response.json({ id: PROJECT_ID, slug: PROJECT_SLUG });
        }
        if (
          request.method === "GET" &&
          (url.pathname === `/api/projects/${PROJECT_ID}` ||
            url.pathname === `/api/projects/${PROJECT_SLUG}`)
        ) {
          return Response.json({ id: PROJECT_ID, slug: PROJECT_SLUG });
        }
        if (request.method === "GET" && url.pathname.endsWith("/files")) {
          return Response.json({
            data: [...pushedFiles].map(([path, content]) => ({ path, content })),
            page_info: {},
          });
        }
        if (request.method === "PUT" && url.pathname.includes("/files/")) {
          const path = decodeURIComponent(url.pathname.split("/files/")[1] ?? "");
          const body = await request.clone().json() as { content: string };
          pushedFiles.set(path, body.content);
          uploadedPaths.push(path);
          return Response.json({});
        }
        if (url.pathname.endsWith("/branches")) {
          return request.method === "POST"
            ? Response.json({ id: "branch-1", name: "main", projectId: PROJECT_ID })
            : Response.json({ data: [], page_info: {} });
        }
        // Fail closed: a 404 here would be read as a transient status and
        // retried until the readiness deadline, turning an unexpected call
        // into a timeout instead of naming it.
        throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
      }, () =>
        upCommand(
          {
            projectDir: relativeProjectDir ? relative(Deno.cwd(), projectDir) : projectDir,
            dryRun,
          },
          undefined,
          {
            deployProject: createDeployProject({
              polling: {
                assetManifestPollIntervalMs: 1,
                assetManifestTimeoutMs: 100,
                environmentPollIntervalMs: 1,
                environmentTimeoutMs: 1_000,
              },
              controlPlaneFactory: () => controlPlane,
            }),
          },
        ));

    try {
      await withDeployEnv(run);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    return { output, controlPlane, projectCreates, uploadedPaths, failure };
  } finally {
    console.log = originalLog;
    setJsonMode(false);
    resetInteractiveMode();
    await remove(projectDir, { recursive: true });
  }
}

describe("up end to end", () => {
  it("accepts a relative project directory", async () => {
    const run = await runUp({ relativeProjectDir: true });

    assertEquals(run.failure, null);
    assertEquals(run.controlPlane.createdReleases.length, 1);
    assertEquals(run.controlPlane.createdDeployments.length, 1);
  });

  it("creates the project, pushes source, and prints the verified preview URL", async () => {
    const run = await runUp();

    assertEquals(run.failure, null);
    assertEquals(run.projectCreates, 1);
    assertEquals(run.uploadedPaths.includes("app/page.tsx"), true);
    assertEquals(run.controlPlane.createdReleases.length, 1);
    assertEquals(run.controlPlane.createdDeployments.length, 1);
    assertEquals(run.controlPlane.createdDeployments[0]?.environmentId, ENVIRONMENT_ID);

    const lines = run.output.map(stripAnsi);
    assertEquals(lines.includes(`  ✓ ${PROJECT_SLUG} is ready`), true);
    // The URL printed is the environment domain the control plane returned and
    // the deploy probed, not a hostname rebuilt from the local slug.
    assertEquals(lines.includes(`  Preview: ${PREVIEW_DOMAIN}`), true);
    assertEquals(lines.some((line) => line.includes("preview.veryfront.com")), false);
  });

  it("reports the same verified URL as the single JSON result", async () => {
    const run = await runUp({ jsonMode: true });

    assertEquals(run.failure, null);
    assertEquals(run.output.length, 1);
    assertEquals(JSON.parse(run.output[0]!), {
      type: "result",
      success: true,
      data: {
        projectSlug: PROJECT_SLUG,
        dryRun: false,
        studioUrl: `https://veryfront.com/projects/${PROJECT_SLUG}?branch=main`,
        previewUrl: PREVIEW_DOMAIN,
        nextCommand: "veryfront deploy",
      },
    });
  });

  it("plans a dry run without mutating the control plane", async () => {
    const run = await runUp({ dryRun: true, jsonMode: true });

    assertEquals(run.failure, null);
    assertEquals(run.projectCreates, 0);
    assertEquals(run.uploadedPaths, []);
    assertEquals(run.controlPlane.createdReleases, []);
    assertEquals(run.controlPlane.createdDeployments, []);
    assertEquals(run.controlPlane.projectLookups, []);

    assertEquals(run.output.length, 1);
    assertEquals(JSON.parse(run.output[0]!), {
      type: "result",
      success: true,
      data: {
        projectSlug: PROJECT_SLUG,
        dryRun: true,
        plannedActions: ["create-project", "push-source", "deploy-preview"],
      },
    });
  });

  it("fails a dry run whose push receipt describes another branch", async () => {
    const run = await runUp({ dryRun: true, receiptBranch: "feature-x" });

    // up targets main, the receipt is for feature-x: the deploy it plans could
    // not run, so the plan is refused instead of printed. Before up delegated
    // to Deploy Execution its dry run returned before anything read the
    // receipt, and reported a push it would not have made.
    assertEquals(
      run.failure,
      'Preview deployment failed: The latest push is for branch "feature-x", but deploy targets ' +
        '"main". Run veryfront deploy --branch feature-x to deploy the latest push, or veryfront ' +
        "push --branch main to preview main first.",
    );
    assertEquals(run.projectCreates, 0);
    assertEquals(run.uploadedPaths, []);
    assertEquals(run.controlPlane.createdReleases, []);
    assertEquals(run.controlPlane.createdDeployments, []);
    assertEquals(run.output.some((line) => line.includes("is ready")), false);
  });
});
