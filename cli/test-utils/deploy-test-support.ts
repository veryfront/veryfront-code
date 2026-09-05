/**
 * Shared test support for Deploy Execution suites.
 *
 * Used by deploy-project.test.ts and the MCP deploy-tool tests so both drive
 * the real DeployProject module over the same fake control plane.
 *
 * @module cli/test-utils/deploy-test-support
 */

import { assertEquals } from "veryfront/testing/assert";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import {
  RELEASE_ASSET_BASE_PATH,
  RELEASE_ASSET_CONTENT_TYPES,
  RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
  type ReleaseAssetManifestResponse,
} from "veryfront/release-assets";
import { computeSourceDigest, writePushReceipt } from "../shared/deployment-provenance.ts";
import type {
  DeployControlPlane,
  DeployDeployment,
  DeployEnvironment,
  DeployProjectRecord,
  DeployRelease,
  DeployReleaseFile,
  EnvironmentAccessToken,
} from "../shared/deployment/control-plane.ts";

export const CONTROL_PLANE = "https://control.example.test/api";
export const PROJECT_ID = "project-1";
export const PROJECT_SLUG = "my-project";
export const ENVIRONMENT_ID = "environment-1";
export const APP_ROUTE_CONTENT = "export default function Page() { return <main>Hello</main>; }\n";

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

export async function commitProject(projectDir: string) {
  await runGit(projectDir, "init", "--quiet");
  await runGit(projectDir, "config", "user.email", "test@veryfront.com");
  await runGit(projectDir, "config", "user.name", "Veryfront Test");
  await runGit(projectDir, "add", ".");
  await runGit(projectDir, "commit", "--quiet", "-m", "initial");
  const result = await new Deno.Command("git", {
    args: ["rev-parse", "HEAD"],
    cwd: projectDir,
    clearEnv: true,
    env: Object.fromEntries(
      Object.entries(Deno.env.toObject()).filter(([key]) => !key.startsWith("GIT_")),
    ),
    stdout: "piped",
  }).output();
  return new TextDecoder().decode(result.stdout).trim();
}

export function projectConfigText(): string {
  return JSON.stringify({ projectSlug: PROJECT_SLUG, apiUrl: CONTROL_PLANE }, null, 2) + "\n";
}

/**
 * A committed project whose push receipt describes exactly the checked-out tree.
 *
 * `extraFiles` are committed with the rest of the source and folded into the
 * receipt digest, so a suite that needs a file beyond the default two still
 * starts from a clean checkout: writing that file after the receipt would leave
 * uncommitted changes, which deploy now refuses as source the push never saw.
 */
export async function createPushedProject(
  extraFiles: readonly DeployReleaseFile[] = [],
): Promise<{ projectDir: string; commitSha: string; files: DeployReleaseFile[] }> {
  const projectDir = await Deno.makeTempDir();
  await Deno.mkdir(`${projectDir}/app`, { recursive: true });
  await Deno.writeTextFile(`${projectDir}/veryfront.json`, projectConfigText());
  await Deno.writeTextFile(`${projectDir}/app/page.tsx`, APP_ROUTE_CONTENT);
  for (const file of extraFiles) {
    await Deno.writeTextFile(`${projectDir}/${file.path}`, file.content);
  }
  const commitSha = await commitProject(projectDir);
  const files: DeployReleaseFile[] = [
    { path: "app/page.tsx", content: APP_ROUTE_CONTENT },
    { path: "veryfront.json", content: projectConfigText() },
    ...extraFiles,
  ];
  const sourceDigest = await computeSourceDigest(files);
  await writePushReceipt(projectDir, {
    controlPlane: CONTROL_PLANE,
    projectId: PROJECT_ID,
    projectSlug: PROJECT_SLUG,
    branch: "main",
    commitSha,
    sourceDigest,
    clean: true,
  });
  return { projectDir, commitSha, files };
}

export async function createUnlinkedPushedProject(): Promise<{
  projectDir: string;
  commitSha: string;
  files: DeployReleaseFile[];
}> {
  const projectDir = await Deno.makeTempDir();
  const configText = JSON.stringify({ apiUrl: CONTROL_PLANE }, null, 2) + "\n";
  await Deno.mkdir(`${projectDir}/app`, { recursive: true });
  await Deno.writeTextFile(`${projectDir}/veryfront.json`, configText);
  await Deno.writeTextFile(`${projectDir}/app/page.tsx`, APP_ROUTE_CONTENT);
  const commitSha = await commitProject(projectDir);
  const files: DeployReleaseFile[] = [
    { path: "app/page.tsx", content: APP_ROUTE_CONTENT },
    { path: "veryfront.json", content: configText },
  ];
  const sourceDigest = await computeSourceDigest(files);
  await writePushReceipt(projectDir, {
    controlPlane: CONTROL_PLANE,
    projectId: PROJECT_ID,
    projectSlug: PROJECT_SLUG,
    branch: "main",
    commitSha,
    sourceDigest,
    clean: true,
  });
  return { projectDir, commitSha, files };
}

export async function withFetchStub<T>(
  handler: (input: string | URL | Request, init?: RequestInit) => Response | Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch =
    ((input: string | URL | Request, init?: RequestInit) =>
      Promise.resolve(handler(input, init))) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export function readyManifest(routes: Record<string, { modules: string[]; css: string[] }> = {
  "/": { modules: ["app/page.js"], css: [] },
}): ReleaseAssetManifestResponse {
  return {
    state: "ready",
    manifest_version: 1,
    manifest: {
      schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
      projectId: PROJECT_ID,
      releaseId: "release-1",
      releaseVersion: 1,
      manifestVersion: 1,
      builderVersion: "test",
      sourceContentHash: "a".repeat(64),
      createdAt: "2026-07-30T00:00:00.000Z",
      assetBasePath: RELEASE_ASSET_BASE_PATH,
      modules: {
        "app/page.js": {
          contentHash: "b".repeat(64),
          size: 12,
          contentType: RELEASE_ASSET_CONTENT_TYPES.js,
        },
      },
      css: [],
      routes,
      dependencyMode: "immutable",
      dependencies: {},
    },
  };
}

/**
 * Run `fn` with the ambient GitHub Actions commit SHA out of the environment.
 *
 * Deploy fixtures commit their own throwaway repository under a temp directory,
 * so a CI job's `GITHUB_SHA` describes a completely different repository.
 * `resolveGitSource` fails closed when the environment SHA and the checkout's
 * HEAD disagree, which would otherwise make every fixture look like a dirty,
 * commit-less checkout on CI and nowhere else.
 */
export async function withoutAmbientCommitSha<T>(fn: () => Promise<T>): Promise<T> {
  const saved = Deno.env.get("GITHUB_SHA");
  try {
    Deno.env.delete("GITHUB_SHA");
    return await fn();
  } finally {
    if (saved === undefined) Deno.env.delete("GITHUB_SHA");
    else Deno.env.set("GITHUB_SHA", saved);
  }
}

export async function withDeployEnv<T>(
  fn: () => Promise<T>,
  overrides: Record<string, string | null> = {},
): Promise<T> {
  const defaults: Record<string, string | null> = {
    VERYFRONT_API_TOKEN: "test-token",
    VERYFRONT_API_URL: CONTROL_PLANE,
    VERYFRONT_PROJECT_SLUG: null,
    VERYFRONT_PROJECT_ID: null,
    // Fixtures own a temp Git repository of their own; see
    // {@link withoutAmbientCommitSha}.
    GITHUB_SHA: null,
    ...overrides,
  };
  const keys = Object.keys(defaults);
  const saved = keys.map((key) => Deno.env.get(key));
  try {
    for (const key of keys) {
      const value = defaults[key];
      if (value == null) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
    _resetEnvironmentConfig();
    return await fn();
  } finally {
    keys.forEach((key, index) => {
      const value = saved[index];
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    });
    _resetEnvironmentConfig();
  }
}

export class InMemoryDeployControlPlane implements DeployControlPlane {
  readonly controlPlane = CONTROL_PLANE;
  readonly createdReleases: DeployRelease[] = [];
  readonly createdDeployments: DeployDeployment[] = [];
  readonly projectLookups: string[] = [];
  getProjectError: unknown;
  environment: DeployEnvironment | null | undefined;
  /**
   * Custom domains the environment reports. Set to `[]` to make the CLI fall
   * back to synthesising the `{slug}.{environment}.veryfront.com` hosted URL.
   */
  environmentDomains: string[] = ["https://my-project.production.veryfront.com"];
  /** Whether the default environment sits behind the platform access gate. */
  environmentProtected = false;
  /** What the API hands back for the stored API key; null means the exchange fails. */
  environmentAccessToken: string | null = null;
  /** HTTP status the failed exchange reports, as the CLI API client attaches it. */
  environmentAccessTokenFailureStatus = 404;
  readonly environmentAccessTokenRequests: Array<{ projectId: string; environmentName: string }> =
    [];
  releaseVersion: string | null = "2026.07.30-1";
  releaseProjectId = PROJECT_ID;
  releaseFiles: DeployReleaseFile[] = [
    { path: "app/page.tsx", content: APP_ROUTE_CONTENT },
    { path: "veryfront.json", content: projectConfigText() },
  ];
  manifestResponses: Array<ReleaseAssetManifestResponse | null> = [readyManifest()];
  deploymentRoutingConvergence:
    | DeployDeployment["routingConvergence"]
    | undefined = { status: "converged", acknowledged: 1, recipients: 1 };
  deploymentReadCount = 0;

  private release: DeployRelease | null = null;
  private deployment: DeployDeployment | null = null;

  async getProject(reference: string): Promise<DeployProjectRecord> {
    this.projectLookups.push(reference);
    if (this.getProjectError) throw this.getProjectError;
    return { id: PROJECT_ID, slug: PROJECT_SLUG };
  }

  async getEnvironment(_reference: string, name: string): Promise<DeployEnvironment | null> {
    if (this.environment !== undefined) return this.environment;
    return {
      id: ENVIRONMENT_ID,
      name,
      protected: this.environmentProtected,
      projectId: PROJECT_ID,
      deployment: this.deploymentReadCount > 0 && this.deployment && this.release
        ? {
          id: this.deployment.id,
          release: { id: this.release.id, name: this.release.name },
        }
        : null,
      domains: this.environmentDomains,
    };
  }

  async createRelease(
    _reference: string,
    input: { name?: string; branch: string },
  ): Promise<DeployRelease> {
    const release = {
      id: "release-1",
      name: input.name ?? input.branch,
      version: this.releaseVersion,
      projectId: this.releaseProjectId,
    };
    this.release = release;
    this.createdReleases.push(release);
    return release;
  }

  async getRelease(_reference: string, releaseId: string): Promise<DeployRelease> {
    return this.release ?? {
      id: releaseId,
      name: "main",
      version: this.releaseVersion,
      projectId: this.releaseProjectId,
    };
  }

  async *listReleaseFiles(
    _reference: string,
    _releaseId: string,
  ): AsyncIterable<DeployReleaseFile> {
    for (const file of this.releaseFiles) yield file;
  }

  getReleaseAssetManifest() {
    return Promise.resolve(
      this.manifestResponses.length > 1
        ? this.manifestResponses.shift() ?? null
        : this.manifestResponses[0] ?? null,
    );
  }

  async createDeployment(
    _reference: string,
    input: { releaseId: string; environmentId: string },
  ): Promise<DeployDeployment> {
    const deployment = {
      id: "deployment-1",
      releaseId: input.releaseId,
      environmentId: input.environmentId,
      routingConvergence: this.deploymentRoutingConvergence,
    };
    this.deployment = deployment;
    this.createdDeployments.push(deployment);
    return deployment;
  }

  async createEnvironmentAccessToken(
    target: { projectId: string; environmentName: string },
  ): Promise<EnvironmentAccessToken> {
    this.environmentAccessTokenRequests.push({ ...target });
    if (this.environmentAccessToken === null) {
      // Shaped like the CLI API client's error: a status, and a message that
      // carries whatever the server said, which must never reach a warning.
      throw Object.assign(
        new Error(
          `API request failed: ${this.environmentAccessTokenFailureStatus} server detail: internal-host-10.0.0.7`,
        ),
        { status: this.environmentAccessTokenFailureStatus },
      );
    }
    return { accessToken: this.environmentAccessToken, expiresIn: 300 };
  }

  async getDeployment(_reference: string, deploymentId: string): Promise<DeployDeployment> {
    this.deploymentReadCount++;
    return this.deployment ?? {
      id: deploymentId,
      releaseId: "release-1",
      environmentId: ENVIRONMENT_ID,
    };
  }
}
