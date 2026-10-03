import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { ReloadNotifier, type ReloadProjectInfo } from "./reload-notifier.ts";

function nextReload(): Promise<{ changedPaths?: string[]; project?: ReloadProjectInfo }> {
  return new Promise((resolve) => {
    const unsubscribe = ReloadNotifier.subscribe((changedPaths, project) => {
      unsubscribe();
      resolve({ changedPaths, project });
    });
  });
}

const preview: ReloadProjectInfo = {
  projectSlug: "test-project",
  projectId: "project-1",
  environment: "preview",
  branch: null,
};

describe("ReloadNotifier", () => {
  afterEach(() => {
    ReloadNotifier.reset();
  });

  it("keeps a prepared style artifact when a coalesced reload for the same project has none", async () => {
    const reload = nextReload();

    ReloadNotifier.triggerReload(["app/page.tsx"], {
      ...preview,
      styleArtifactHash: "hash-1",
      styleAssetPath: "/_vf/css/hash-1.css",
    });
    ReloadNotifier.triggerReload(["app/page.tsx"], { ...preview });

    const { changedPaths, project } = await reload;
    assertEquals(changedPaths, ["app/page.tsx"]);
    assertEquals(project?.styleArtifactHash, "hash-1");
    assertEquals(project?.styleAssetPath, "/_vf/css/hash-1.css");
  });

  it("does not carry a style artifact over to another project", async () => {
    const reload = nextReload();

    ReloadNotifier.triggerReload(["app/page.tsx"], {
      ...preview,
      styleArtifactHash: "hash-1",
      styleAssetPath: "/_vf/css/hash-1.css",
    });
    ReloadNotifier.triggerReload(["app/page.tsx"], { ...preview, projectId: "project-2" });

    const { project } = await reload;
    assertEquals(project?.projectId, "project-2");
    assertEquals(project?.styleArtifactHash, undefined);
  });

  it("uses the newest style artifact for the same project", async () => {
    const reload = nextReload();

    ReloadNotifier.triggerReload(undefined, { ...preview, styleArtifactHash: "hash-1" });
    ReloadNotifier.triggerReload(undefined, { ...preview, styleArtifactHash: "hash-2" });

    const { project } = await reload;
    assertEquals(project?.styleArtifactHash, "hash-2");
  });
});
