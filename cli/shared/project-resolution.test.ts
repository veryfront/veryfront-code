import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "veryfront/platform/path";
import type { ProjectReferenceSource, ResolvedConfig } from "./config.ts";
import { PROJECT_LINK_RELATIVE_PATH } from "./project-link.ts";
import {
  canPersistAlternativeSlug,
  getErrorStatus,
  projectApiReference,
  ProjectReferenceNotFoundError,
  type ProjectResolutionClient,
  resolveOrCreateProject,
  shouldPersistProjectLink,
  slugConflictAction,
} from "./project-resolution.ts";
import { ProjectSlugConflictError } from "./reserve-slug.ts";

const CONTROL_PLANE = "https://control.example.test/api";

function config(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    apiUrl: CONTROL_PLANE,
    apiToken: "token",
    projectSlug: "my-app",
    ...overrides,
  } as ResolvedConfig;
}

const INFERRED: ProjectReferenceSource = { kind: "inferred", name: "project files" };
const LOCAL_LINK: ProjectReferenceSource = { kind: "local-link", name: ".veryfront/project.json" };
const JSON_CONFIG: ProjectReferenceSource = { kind: "json-config", name: "veryfront.json" };
const ARGUMENT: ProjectReferenceSource = { kind: "argument", name: "--project" };

interface FakeCalls {
  getProject: string[];
  reserveSlug: Array<{ slug: string; allowAlternativeSlug: boolean }>;
}

function notFound(): Error {
  const error = new Error("API request failed: 404 Not Found") as Error & { status: number };
  error.status = 404;
  return error;
}

function serverError(): Error {
  const error = new Error("API request failed: 500 Server Error") as Error & { status: number };
  error.status = 500;
  return error;
}

function fakeClient(behaviour: {
  project?: { id: string; slug: string };
  getProjectError?: () => Error;
  reserve?: { slug: string; projectId: string };
  reserveError?: () => Error;
}): { client: ProjectResolutionClient; calls: FakeCalls } {
  const calls: FakeCalls = { getProject: [], reserveSlug: [] };
  const client: ProjectResolutionClient = {
    getProject: (reference) => {
      calls.getProject.push(reference);
      if (behaviour.getProjectError) return Promise.reject(behaviour.getProjectError());
      return Promise.resolve(behaviour.project ?? { id: "proj_1", slug: reference });
    },
    reserveSlug: (slug, options) => {
      calls.reserveSlug.push({ slug, allowAlternativeSlug: options.allowAlternativeSlug });
      if (behaviour.reserveError) return Promise.reject(behaviour.reserveError());
      return Promise.resolve(behaviour.reserve ?? { slug, projectId: "proj_1" });
    },
  };
  return { client, calls };
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await run(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

async function readLink(projectDir: string): Promise<unknown> {
  return JSON.parse(await Deno.readTextFile(join(projectDir, PROJECT_LINK_RELATIVE_PATH)));
}

async function linkExists(projectDir: string): Promise<boolean> {
  try {
    await Deno.stat(join(projectDir, PROJECT_LINK_RELATIVE_PATH));
    return true;
  } catch {
    return false;
  }
}

describe("project reference helpers", () => {
  it("prefers the project id over the slug as the API reference", () => {
    assertEquals(projectApiReference(config({ projectId: "proj_1" })), "proj_1");
    assertEquals(projectApiReference(config()), "my-app");
  });

  it("persists a link only for references this directory owns", () => {
    assertEquals(shouldPersistProjectLink(INFERRED), true);
    assertEquals(shouldPersistProjectLink(LOCAL_LINK), true);
    assertEquals(shouldPersistProjectLink(JSON_CONFIG), false);
    assertEquals(shouldPersistProjectLink(ARGUMENT), false);
  });

  it("allows an alternative slug only for an inferred reference", () => {
    assertEquals(canPersistAlternativeSlug(INFERRED), true);
    assertEquals(canPersistAlternativeSlug(LOCAL_LINK), false);
  });

  it("reads a numeric status off an error and ignores everything else", () => {
    assertEquals(getErrorStatus(notFound()), 404);
    assertEquals(getErrorStatus(new Error("no status")), undefined);
    assertEquals(getErrorStatus("not an object"), undefined);
    assertEquals(getErrorStatus(null), undefined);
  });

  it("phrases the slug conflict remedy against the reference source", () => {
    assertEquals(slugConflictAction(ARGUMENT), "Use a different --project value");
    assertEquals(
      slugConflictAction({ kind: "environment", name: "environment configuration" }),
      "Update or remove VERYFRONT_PROJECT_SLUG",
    );
    assertEquals(
      slugConflictAction({ kind: "module-config", name: "veryfront.config.ts" }),
      "Update projectSlug in veryfront.config.ts",
    );
    assertEquals(
      slugConflictAction({ kind: "tenant-environment", name: "TENANT_PROJECT_SLUG" }),
      "Update or remove TENANT_PROJECT_SLUG",
    );
    assertEquals(slugConflictAction(JSON_CONFIG), "Choose a different project slug");
    assertEquals(slugConflictAction(LOCAL_LINK), "Relink this project");
  });
});

describe("resolveOrCreateProject", () => {
  describe("an existing named project", () => {
    it("persists the link for a local-link reference", async () => {
      await withTempDir(async (dir) => {
        const { client, calls } = fakeClient({ project: { id: "proj_1", slug: "my-app" } });
        const outcome = await resolveOrCreateProject({
          projectDir: dir,
          config: config({ projectId: "proj_1" }),
          source: LOCAL_LINK,
          client,
        });

        assertEquals(outcome.kind, "existing");
        assertEquals(calls.getProject, ["proj_1"]);
        if (outcome.kind !== "existing") throw new Error("unreachable");
        assertEquals(outcome.persisted, true);
        assertEquals(outcome.config.projectId, "proj_1");
        assertEquals(outcome.config.projectSlug, "my-app");
        assertEquals(await readLink(dir), {
          version: 1,
          controlPlane: CONTROL_PLANE,
          projectId: "proj_1",
          projectSlug: "my-app",
        });
      });
    });

    it("does not persist a link for a json-config reference", async () => {
      await withTempDir(async (dir) => {
        const { client, calls } = fakeClient({ project: { id: "proj_1", slug: "my-app" } });
        const outcome = await resolveOrCreateProject({
          projectDir: dir,
          config: config(),
          source: JSON_CONFIG,
          client,
        });

        assertEquals(outcome.kind, "existing");
        assertEquals(calls.getProject, ["my-app"]);
        if (outcome.kind !== "existing") throw new Error("unreachable");
        assertEquals(outcome.persisted, false);
        assertEquals(await linkExists(dir), false);
      });
    });

    it("plans without persisting when the run is a dry run", async () => {
      await withTempDir(async (dir) => {
        const { client, calls } = fakeClient({ project: { id: "proj_1", slug: "my-app" } });
        const outcome = await resolveOrCreateProject({
          projectDir: dir,
          config: config({ projectId: "proj_1" }),
          source: LOCAL_LINK,
          client,
          dryRun: true,
        });

        if (outcome.kind !== "existing") throw new Error("unreachable");
        assertEquals(outcome.persisted, false);
        assertEquals(outcome.config.projectId, "proj_1");
        assertEquals(calls.reserveSlug, []);
        assertEquals(await linkExists(dir), false);
      });
    });
  });

  describe("a named project that is gone", () => {
    it("reports a reference held by id", async () => {
      await withTempDir(async (dir) => {
        const { client } = fakeClient({ getProjectError: notFound });
        const error = await assertRejects(
          () =>
            resolveOrCreateProject({
              projectDir: dir,
              config: config({ projectId: "proj_gone" }),
              source: LOCAL_LINK,
              client,
              createMissingReference: true,
            }),
          ProjectReferenceNotFoundError,
        );

        assertInstanceOf(error, ProjectReferenceNotFoundError);
        assertEquals(error.reference, "proj_gone");
        assertEquals(error.byId, true);
        assertEquals(error.source, LOCAL_LINK);
      });
    });

    it("reports a named slug when the caller does not create missing projects", async () => {
      await withTempDir(async (dir) => {
        const { client, calls } = fakeClient({ getProjectError: notFound });
        const error = await assertRejects(
          () =>
            resolveOrCreateProject({
              projectDir: dir,
              config: config(),
              source: JSON_CONFIG,
              client,
              createMissingReference: false,
            }),
          ProjectReferenceNotFoundError,
        );

        assertInstanceOf(error, ProjectReferenceNotFoundError);
        assertEquals(error.reference, "my-app");
        assertEquals(error.byId, false);
        assertEquals(calls.reserveSlug, []);
      });
    });

    it("creates the project when the caller opts in", async () => {
      await withTempDir(async (dir) => {
        const { client, calls } = fakeClient({
          getProjectError: notFound,
          reserve: { slug: "my-app", projectId: "proj_new" },
        });
        const outcome = await resolveOrCreateProject({
          projectDir: dir,
          config: config(),
          source: JSON_CONFIG,
          client,
          createMissingReference: true,
        });

        assertEquals(outcome.kind, "created");
        if (outcome.kind !== "created") throw new Error("unreachable");
        assertEquals(outcome.project, { id: "proj_new", slug: "my-app" });
        assertEquals(outcome.requestedSlug, "my-app");
        assertEquals(outcome.persisted, false);
        assertEquals(calls.reserveSlug, [{ slug: "my-app", allowAlternativeSlug: false }]);
        assertEquals(await linkExists(dir), false);
      });
    });

    it("only plans the create on a dry run, never reserving the slug", async () => {
      await withTempDir(async (dir) => {
        const { client, calls } = fakeClient({ getProjectError: notFound });
        const outcome = await resolveOrCreateProject({
          projectDir: dir,
          config: config(),
          source: JSON_CONFIG,
          client,
          createMissingReference: true,
          dryRun: true,
        });

        assertEquals(outcome.kind, "planned-create");
        if (outcome.kind !== "planned-create") throw new Error("unreachable");
        assertEquals(outcome.plannedSlug, "my-app");
        assertEquals(calls.reserveSlug, []);
        assertEquals(await linkExists(dir), false);
      });
    });

    it("rethrows a non-404 lookup failure unchanged", async () => {
      await withTempDir(async (dir) => {
        const raised = serverError();
        const { client } = fakeClient({ getProjectError: () => raised });
        const error = await assertRejects(() =>
          resolveOrCreateProject({
            projectDir: dir,
            config: config(),
            source: JSON_CONFIG,
            client,
            createMissingReference: true,
          })
        );

        assertEquals(error, raised);
      });
    });
  });

  describe("an inferred reference", () => {
    it("creates the project and writes the canonical link", async () => {
      await withTempDir(async (dir) => {
        const { client, calls } = fakeClient({
          reserve: { slug: "my-app", projectId: "proj_new" },
        });
        const outcome = await resolveOrCreateProject({
          projectDir: dir,
          config: config(),
          source: INFERRED,
          client,
        });

        assertEquals(outcome.kind, "created");
        if (outcome.kind !== "created") throw new Error("unreachable");
        assertEquals(outcome.persisted, true);
        assertEquals(calls.getProject, []);
        assertEquals(calls.reserveSlug, [{ slug: "my-app", allowAlternativeSlug: true }]);
        assertEquals(await readLink(dir), {
          version: 1,
          controlPlane: CONTROL_PLANE,
          projectId: "proj_new",
          projectSlug: "my-app",
        });
      });
    });

    it("looks up the canonical id when the reservation omits it", async () => {
      await withTempDir(async (dir) => {
        const { client, calls } = fakeClient({
          reserve: { slug: "my-app", projectId: "" },
          project: { id: "proj_canonical", slug: "my-app" },
        });
        const outcome = await resolveOrCreateProject({
          projectDir: dir,
          config: config(),
          source: INFERRED,
          client,
        });

        if (outcome.kind !== "created") throw new Error("unreachable");
        assertEquals(calls.getProject, ["my-app"]);
        assertEquals(outcome.project, { id: "proj_canonical", slug: "my-app" });
        // An empty reservation id must never leave the project unlinked.
        assertEquals(outcome.persisted, true);
        assertEquals(await readLink(dir), {
          version: 1,
          controlPlane: CONTROL_PLANE,
          projectId: "proj_canonical",
          projectSlug: "my-app",
        });
      });
    });

    it("reports the alternative slug the control plane handed back", async () => {
      await withTempDir(async (dir) => {
        const { client } = fakeClient({
          reserve: { slug: "my-app-x1y2z3", projectId: "proj_alt" },
        });
        const outcome = await resolveOrCreateProject({
          projectDir: dir,
          config: config(),
          source: INFERRED,
          client,
        });

        if (outcome.kind !== "created") throw new Error("unreachable");
        assertEquals(outcome.requestedSlug, "my-app");
        assertEquals(outcome.project.slug, "my-app-x1y2z3");
        assertEquals(outcome.config.projectSlug, "my-app-x1y2z3");
        assertEquals(await readLink(dir), {
          version: 1,
          controlPlane: CONTROL_PLANE,
          projectId: "proj_alt",
          projectSlug: "my-app-x1y2z3",
        });
      });
    });

    it("plans the create without reserving or persisting on a dry run", async () => {
      await withTempDir(async (dir) => {
        const { client, calls } = fakeClient({});
        const outcome = await resolveOrCreateProject({
          projectDir: dir,
          config: config(),
          source: INFERRED,
          client,
          dryRun: true,
        });

        assertEquals(outcome.kind, "planned-create");
        if (outcome.kind !== "planned-create") throw new Error("unreachable");
        assertEquals(outcome.plannedSlug, "my-app");
        assertEquals(calls.reserveSlug, []);
        assertEquals(calls.getProject, []);
        assertEquals(await linkExists(dir), false);
      });
    });

    it("propagates a slug conflict for adapters to phrase", async () => {
      await withTempDir(async (dir) => {
        const { client } = fakeClient({
          reserveError: () => new ProjectSlugConflictError("my-app"),
        });
        const error = await assertRejects(
          () =>
            resolveOrCreateProject({
              projectDir: dir,
              config: config(),
              source: INFERRED,
              client,
              allowAlternativeSlug: false,
            }),
          ProjectSlugConflictError,
        );

        assertInstanceOf(error, ProjectSlugConflictError);
        assertEquals(error.slug, "my-app");
        assertEquals(error.message, 'Project slug "my-app" is already in use.');
      });
    });
  });
});
