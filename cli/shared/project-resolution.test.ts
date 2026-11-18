import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "veryfront/platform/path";
import type { ProjectReferenceSource, ResolvedConfig } from "./config.ts";
import { PROJECT_LINK_RELATIVE_PATH } from "./project-link.ts";
import {
  canPersistAlternativeSlug,
  describeStaleProjectReference,
  getErrorStatus,
  type InferredProjectChoice,
  inferredProjectQuestion,
  projectApiReference,
  ProjectReferenceNotFoundError,
  type ProjectResolutionClient,
  resolveOrCreateProject,
  shouldPersistProjectLink,
  slugConflictAction,
  staleProjectReferenceContext,
  UnlinkedProjectError,
  unlinkedProjectMessage,
} from "./project-resolution.ts";
import { PERMISSION_DENIED } from "veryfront/errors";
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
        assertEquals(
          await Deno.stat(join(dir, "veryfront.json")).then(() => true, () => false),
          false,
        );
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
        // The lookup used the uuid, but the directory also held the slug: both
        // adapters need it so they name the project the way the user does.
        assertEquals(error.projectId, "proj_gone");
        assertEquals(error.projectSlug, "my-app");
      });
    });

    it("describes a stale link by slug and id, whichever identifier the lookup used", async () => {
      await withTempDir(async (dir) => {
        const { client } = fakeClient({ getProjectError: notFound });
        const byId = await assertRejects(
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
        assertInstanceOf(byId, ProjectReferenceNotFoundError);

        const bySlug = await assertRejects(
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
        assertInstanceOf(bySlug, ProjectReferenceNotFoundError);

        assertEquals(
          describeStaleProjectReference(byId),
          'Project "my-app" (proj_gone) was not found. The reference came from ' +
            ".veryfront/project.json; the project may have been deleted, or it may belong to an " +
            "account other than the one you are logged in as.",
        );
        assertEquals(
          describeStaleProjectReference(bySlug),
          'Project "my-app" was not found. The reference came from veryfront.json; the project ' +
            "may have been deleted, or it may belong to an account other than the one you are " +
            "logged in as.",
        );
        assertEquals(staleProjectReferenceContext(byId), {
          reference: "proj_gone",
          projectId: "proj_gone",
          projectSlug: "my-app",
          source: "local-link",
          sourceName: ".veryfront/project.json",
        });
      });
    });

    it("names a reference that is only an id once", () => {
      // VERYFRONT_PROJECT_ID records the same string as slug and id; `"x" (x)`
      // would read as two projects.
      const error = new ProjectReferenceNotFoundError(
        "proj_env",
        { kind: "tenant-environment", name: "VERYFRONT_PROJECT_ID" },
        true,
        { projectId: "proj_env", projectSlug: "proj_env" },
      );
      assertEquals(
        describeStaleProjectReference(error),
        'Project "proj_env" was not found. The reference came from VERYFRONT_PROJECT_ID; the ' +
          "project may have been deleted, or it may belong to an account other than the one you " +
          "are logged in as.",
      );
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

  describe("an inferred reference that the caller creates", () => {
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
          inferredProject: "create",
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
          inferredProject: "create",
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
          inferredProject: "create",
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
          inferredProject: "create",
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
              inferredProject: "create",
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
  describe("an inferred reference that the caller did not settle", () => {
    it("refuses before any lookup, reservation or link", async () => {
      await withTempDir(async (dir) => {
        const { client, calls } = fakeClient({});
        for (const dryRun of [false, true]) {
          const error = await assertRejects(
            () =>
              resolveOrCreateProject({
                projectDir: dir,
                config: config(),
                source: INFERRED,
                client,
                dryRun,
              }),
            UnlinkedProjectError,
          );
          assertInstanceOf(error, UnlinkedProjectError);
          assertEquals(error.inferredSlug, "my-app");
          assertEquals(error.declined, false);
        }
        assertEquals(calls, { getProject: [], reserveSlug: [] });
        assertEquals(await linkExists(dir), false);
      });
    });
  });

  describe("an inferred reference that the caller confirms", () => {
    function recordingConfirm(answer: boolean) {
      const choices: InferredProjectChoice[] = [];
      const confirm = (choice: InferredProjectChoice) => {
        choices.push(choice);
        return Promise.resolve(answer);
      };
      return { choices, confirm };
    }

    it("offers to create a missing project and creates exactly that slug", async () => {
      await withTempDir(async (dir) => {
        const { client, calls } = fakeClient({
          getProjectError: notFound,
          reserve: { slug: "my-app", projectId: "proj_new" },
        });
        const { choices, confirm } = recordingConfirm(true);
        const outcome = await resolveOrCreateProject({
          projectDir: dir,
          config: config(),
          source: INFERRED,
          client,
          inferredProject: confirm,
        });

        assertEquals(choices, [{ slug: "my-app", existing: null }]);
        assertEquals(outcome.kind, "created");
        assertEquals(calls.reserveSlug, [{ slug: "my-app", allowAlternativeSlug: false }]);
        assertEquals(await readLink(dir), {
          version: 1,
          controlPlane: CONTROL_PLANE,
          projectId: "proj_new",
          projectSlug: "my-app",
        });
      });
    });

    it("offers the existing project with that slug and links it without creating one", async () => {
      await withTempDir(async (dir) => {
        const { client, calls } = fakeClient({ project: { id: "proj_mine", slug: "my-app" } });
        const { choices, confirm } = recordingConfirm(true);
        const outcome = await resolveOrCreateProject({
          projectDir: dir,
          config: config(),
          source: INFERRED,
          client,
          inferredProject: confirm,
        });

        assertEquals(choices, [{ slug: "my-app", existing: { id: "proj_mine", slug: "my-app" } }]);
        assertEquals(outcome.kind, "existing");
        assertEquals(calls.reserveSlug, []);
        assertEquals(await readLink(dir), {
          version: 1,
          controlPlane: CONTROL_PLANE,
          projectId: "proj_mine",
          projectSlug: "my-app",
        });
      });
    });

    it("refuses when the answer is no, and changes nothing", async () => {
      await withTempDir(async (dir) => {
        const { client, calls } = fakeClient({ getProjectError: notFound });
        const { confirm } = recordingConfirm(false);
        const error = await assertRejects(
          () =>
            resolveOrCreateProject({
              projectDir: dir,
              config: config(),
              source: INFERRED,
              client,
              inferredProject: confirm,
            }),
          UnlinkedProjectError,
        );

        assertInstanceOf(error, UnlinkedProjectError);
        assertEquals(error.declined, true);
        assertEquals(calls.reserveSlug, []);
        assertEquals(await linkExists(dir), false);
      });
    });

    it("plans a confirmed create on a dry run without reserving or linking", async () => {
      await withTempDir(async (dir) => {
        const { client, calls } = fakeClient({ getProjectError: notFound });
        const { confirm } = recordingConfirm(true);
        const outcome = await resolveOrCreateProject({
          projectDir: dir,
          config: config(),
          source: INFERRED,
          client,
          dryRun: true,
          inferredProject: confirm,
        });

        assertEquals(outcome.kind, "planned-create");
        assertEquals(calls.reserveSlug, []);
        assertEquals(await linkExists(dir), false);
      });
    });

    it("links nothing when a dry run confirms an existing project", async () => {
      await withTempDir(async (dir) => {
        const { client, calls } = fakeClient({ project: { id: "proj_mine", slug: "my-app" } });
        const { confirm } = recordingConfirm(true);
        const outcome = await resolveOrCreateProject({
          projectDir: dir,
          config: config(),
          source: INFERRED,
          client,
          dryRun: true,
          inferredProject: confirm,
        });

        assertEquals(outcome.kind, "existing");
        if (outcome.kind !== "existing") return;
        assertEquals(outcome.persisted, false);
        assertEquals(outcome.config.projectId, "proj_mine");
        assertEquals(outcome.config.projectSlug, "my-app");
        assertEquals(calls.reserveSlug, []);
        assertEquals(await linkExists(dir), false);
      });
    });

    it("keeps a classified lookup error instead of asking", async () => {
      await withTempDir(async (dir) => {
        const denied = PERMISSION_DENIED.create({ detail: "Access denied" });
        const { client } = fakeClient({ getProjectError: () => denied });
        const { choices, confirm } = recordingConfirm(true);
        const error = await assertRejects(() =>
          resolveOrCreateProject({
            projectDir: dir,
            config: config(),
            source: INFERRED,
            client,
            inferredProject: confirm,
          })
        );
        assertEquals(error, denied);
        assertEquals(choices, []);
      });
    });

    it("does not ask when the lookup fails for a reason other than not found", async () => {
      await withTempDir(async (dir) => {
        const { client } = fakeClient({ getProjectError: serverError });
        const { choices, confirm } = recordingConfirm(true);
        await assertRejects(() =>
          resolveOrCreateProject({
            projectDir: dir,
            config: config(),
            source: INFERRED,
            client,
            inferredProject: confirm,
          })
        );
        assertEquals(choices, []);
      });
    });
  });
});

describe("inferred project copy", () => {
  it("asks to create a project the slug does not name yet", () => {
    assertEquals(
      inferredProjectQuestion("push", { slug: "my-app", existing: null }),
      'No Veryfront project is linked to this folder. Create project "my-app"?',
    );
  });

  it("names the existing project the command would use", () => {
    const existing = { id: "proj_mine", slug: "my-app" };
    assertEquals(
      inferredProjectQuestion("push", { slug: "my-app", existing }),
      'No Veryfront project is linked to this folder. Push to your existing project "my-app"?',
    );
    assertEquals(
      inferredProjectQuestion("deploy", { slug: "my-app", existing }),
      'No Veryfront project is linked to this folder. Deploy your existing project "my-app"?',
    );
  });

  it("points push and deploy at veryfront up or --project", () => {
    assertEquals(
      unlinkedProjectMessage("push"),
      "No Veryfront project is linked to this folder. Run veryfront up to create one, or pass --project <slug> to push to an existing project.",
    );
    assertEquals(
      unlinkedProjectMessage("deploy"),
      "No Veryfront project is linked to this folder. Run veryfront up to create one, or pass --project <slug> to deploy an existing project.",
    );
  });
});
