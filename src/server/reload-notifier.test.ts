import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { ReloadNotifier, type ReloadProjectInfo } from "./reload-notifier.ts";

describe("ReloadNotifier", () => {
  afterEach(() => ReloadNotifier.reset());

  it("debounces independently by project and content source", async () => {
    const events: Array<{ paths?: string[]; project?: ReloadProjectInfo }> = [];
    ReloadNotifier.subscribe((paths, project) => events.push({ paths, project }));

    ReloadNotifier.triggerReload(["app/a.tsx"], {
      projectId: "project-a",
      environment: "preview",
      contentSourceId: "branch-main",
    });
    ReloadNotifier.triggerReload(["app/b.tsx"], {
      projectId: "project-b",
      environment: "preview",
      contentSourceId: "branch-main",
    });
    ReloadNotifier.triggerReload(["app/a-layout.tsx"], {
      projectId: "project-a",
      environment: "preview",
      contentSourceId: "branch-main",
    });
    ReloadNotifier.triggerReload(["app/a-release.tsx"], {
      projectId: "project-a",
      environment: "production",
      contentSourceId: "release-1",
    });

    await new Promise((resolve) => setTimeout(resolve, 350));

    assertEquals(events.length, 3);
    assertEquals(events, [
      {
        paths: ["app/b.tsx"],
        project: {
          projectId: "project-b",
          environment: "preview",
          contentSourceId: "branch-main",
        },
      },
      {
        paths: ["app/a.tsx", "app/a-layout.tsx"],
        project: {
          projectId: "project-a",
          environment: "preview",
          contentSourceId: "branch-main",
        },
      },
      {
        paths: ["app/a-release.tsx"],
        project: {
          projectId: "project-a",
          environment: "production",
          contentSourceId: "release-1",
        },
      },
    ]);
  });

  it("uses collision-safe framing for delimiter-shaped project identities", async () => {
    const events: Array<{ paths?: string[]; project?: ReloadProjectInfo }> = [];
    ReloadNotifier.subscribe((paths, project) => events.push({ paths, project }));

    ReloadNotifier.triggerReload(["one.ts"], {
      projectSlug: "a:preview",
      branch: "main",
    });
    ReloadNotifier.triggerReload(["two.ts"], {
      projectSlug: "a",
      branch: "preview:main",
    });

    await new Promise((resolve) => setTimeout(resolve, 350));
    assertEquals(events.length, 2);
  });
});
