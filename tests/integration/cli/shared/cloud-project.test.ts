import { chooseCloudProject } from "../../../../cli/shared/cloud-project.ts";
import { readProjectLink } from "../../../../cli/shared/project-link.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { deleteEnv, getEnv, setEnv } from "#cli/process-env";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { makeTempDirWithOptions } from "#veryfront/testing/deno-compat.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { saveSharedProjectAssociation } from "../../../../cli/shared/project-link.ts";

it("persists only association while preserving existing configuration", async () => {
  const directory = await makeTempDirWithOptions();
  try {
    await Deno.writeTextFile(
      `${directory}/veryfront.json`,
      JSON.stringify({ projects: ["other"], apiToken: "legacy-secret" }),
    );
    await saveSharedProjectAssociation(directory, "demo");
    assertEquals(JSON.parse(await Deno.readTextFile(`${directory}/veryfront.json`)), {
      projects: ["other"],
      apiToken: "legacy-secret",
      projectSlug: "demo",
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

it("refuses association writes through a veryfront.json symlink", async () => {
  const directory = await makeTempDirWithOptions();
  try {
    await Deno.writeTextFile(`${directory}/outside.json`, "{}");
    await Deno.symlink(`${directory}/outside.json`, `${directory}/veryfront.json`);
    let rejected = false;
    try {
      await saveSharedProjectAssociation(directory, "demo");
    } catch {
      rejected = true;
    }
    assertEquals(rejected, true);
    assertEquals(await Deno.readTextFile(`${directory}/outside.json`), "{}");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

it("retains the write failure and cleans its temporary association", async () => {
  const directory = await makeTempDirWithOptions();
  const originalRename = Deno.rename;
  const failure = new Error("association rename failed");
  try {
    Deno.rename = (() => Promise.reject(failure)) as typeof Deno.rename;
    let caught: unknown;
    try {
      await saveSharedProjectAssociation(directory, "demo");
    } catch (error) {
      caught = error;
    }
    assertEquals(caught, failure);
    assertEquals(await Array.fromAsync(Deno.readDir(directory)), []);
  } finally {
    Deno.rename = originalRename;
    await Deno.remove(directory, { recursive: true });
  }
});

it("preserves the original failure when temporary cleanup also fails", async () => {
  const directory = await makeTempDirWithOptions();
  const originalRename = Deno.rename;
  const originalRemove = Deno.remove;
  const failure = new Error("association rename failed");
  const cleanupFailure = new Error("association cleanup failed");
  try {
    Deno.rename = (() => Promise.reject(failure)) as typeof Deno.rename;
    Deno.remove = (() => Promise.reject(cleanupFailure)) as typeof Deno.remove;
    let caught: unknown;
    try {
      await saveSharedProjectAssociation(directory, "demo");
    } catch (error) {
      caught = error;
    }
    assertEquals(caught instanceof AggregateError, true);
    assertEquals((caught as AggregateError).cause, failure);
    assertEquals((caught as AggregateError).errors, [failure, cleanupFailure]);
  } finally {
    Deno.rename = originalRename;
    Deno.remove = originalRemove;
    await Deno.remove(directory, { recursive: true });
  }
});

it("asks Yes/No before project selection and skips Cloud setup on No", async () => {
  const { chooseCloudProject } = await import("../../../../cli/shared/cloud-project.ts");
  const directory = await makeTempDirWithOptions();
  const prompts: Array<{ question: string; labels: string[] }> = [];
  try {
    await chooseCloudProject(directory, (question, options) => {
      prompts.push({ question, labels: options.map((option) => option.label) });
      return Promise.resolve("no");
    });
    assertEquals(prompts, [{ question: "Use Veryfront Cloud?", labels: ["Yes", "No"] }]);
    assertEquals(await Array.fromAsync(Deno.readDir(directory)), []);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

it("asks new or existing project only after choosing Yes", async () => {
  const { chooseCloudProject } = await import("../../../../cli/shared/cloud-project.ts");
  const prompts: Array<{ question: string; labels: string[] }> = [];
  await chooseCloudProject("unused", (question, options) => {
    prompts.push({ question, labels: options.map((option) => option.label) });
    return Promise.resolve(prompts.length === 1 ? "yes" : null);
  });
  assertEquals(prompts, [
    { question: "Use Veryfront Cloud?", labels: ["Yes", "No"] },
    {
      question: "Choose a cloud project:",
      labels: ["Create a new cloud project", "Use an existing cloud project"],
    },
  ]);
});

it("creates a cloud project without uploading local source", async () => {
  await withCloudSetup(async (directory, requests) => {
    await withMockFetch(
      ((_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(_input), method: init?.method ?? "GET" });
        return Promise.resolve(Response.json({ id: "cloud-new" }, { status: 201 }));
      }) as typeof fetch,
      async () => {
        await chooseCloudProject(directory, (_question, _options) =>
          Promise.resolve(
            requests.length ? null : _question === "Use Veryfront Cloud?" ? "yes" : "new",
          ));
      },
    );
    assertEquals(requests.map((request) => [new URL(request.url).pathname, request.method]), [[
      "/projects",
      "POST",
    ]]);
    assertEquals(JSON.parse(await Deno.readTextFile(`${directory}/veryfront.json`)), {
      projectSlug: "local-app",
      apiUrl: "https://api.veryfront.com",
    });
    assertEquals((await readProjectLink(directory))?.projectId, "cloud-new");
  });
});

it("lists every cloud project page and saves the selected canonical identity", async () => {
  await withCloudSetup(async (directory, requests) => {
    await withMockFetch(
      ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        requests.push({ url: url.href, method: init?.method ?? "GET" });
        return Promise.resolve(Response.json(
          url.searchParams.has("cursor")
            ? {
              data: [{ id: "cloud-second", slug: "shared-app", name: "Shared app" }],
              page_info: {},
            }
            : {
              data: [{ id: "cloud-first", slug: "first-app" }],
              page_info: { next: "next-page" },
            },
        ));
      }) as typeof fetch,
      async () => {
        await chooseCloudProject(directory, (question, options) => {
          if (question === "Use Veryfront Cloud?") return Promise.resolve("yes");
          if (question === "Choose a cloud project:") return Promise.resolve("existing");
          assertEquals(options.map((option) => option.value), ["cloud-first", "cloud-second"]);
          return Promise.resolve("cloud-second");
        });
      },
    );
    assertEquals(requests.length, 2);
    assertEquals(new URL(requests[1]!.url).searchParams.get("cursor"), "next-page");
    assertEquals(JSON.parse(await Deno.readTextFile(`${directory}/veryfront.json`)), {
      projectSlug: "shared-app",
      apiUrl: "https://api.veryfront.com",
    });
    assertEquals((await readProjectLink(directory))?.projectId, "cloud-second");
  });
});

it("leaves local source unassociated when the cloud project list is empty", async () => {
  await withCloudSetup(async (directory) => {
    await withMockFetch(
      (() => Promise.resolve(Response.json({ data: [], page_info: {} }))) as typeof fetch,
      async () => {
        await assertRejects(
          () =>
            chooseCloudProject(
              directory,
              (question) =>
                Promise.resolve(question === "Use Veryfront Cloud?" ? "yes" : "existing"),
            ),
          Error,
          "No cloud projects found",
        );
      },
    );
    assertEquals(await readProjectLink(directory), null);
    assertEquals((await Array.fromAsync(Deno.readDir(directory))).map((entry) => entry.name), [
      "package.json",
    ]);
  });
});

it("keeps the local project unassociated when cloud project selection is cancelled", async () => {
  await withCloudSetup(async (directory) => {
    await withMockFetch(
      (() =>
        Promise.resolve(
          Response.json({ data: [{ id: "cloud-one", slug: "shared" }], page_info: {} }),
        )) as typeof fetch,
      async () => {
        await chooseCloudProject(directory, (question) =>
          Promise.resolve(
            question === "Use Veryfront Cloud?"
              ? "yes"
              : question === "Choose a cloud project:"
              ? "existing"
              : null,
          ));
      },
    );
    assertEquals(await readProjectLink(directory), null);
    assertEquals((await Array.fromAsync(Deno.readDir(directory))).map((entry) => entry.name), [
      "package.json",
    ]);
  });
});

async function withCloudSetup(
  action: (directory: string, requests: Array<{ url: string; method: string }>) => Promise<void>,
) {
  const directory = await makeTempDirWithOptions();
  const saved = getEnv("VERYFRONT_API_TOKEN");
  try {
    setEnv("VERYFRONT_API_TOKEN", "host-only-token");
    _resetEnvironmentConfig();
    await Deno.writeTextFile(`${directory}/package.json`, JSON.stringify({ name: "local-app" }));
    await action(directory, []);
  } finally {
    if (saved === undefined) deleteEnv("VERYFRONT_API_TOKEN");
    else setEnv("VERYFRONT_API_TOKEN", saved);
    _resetEnvironmentConfig();
    await Deno.remove(directory, { recursive: true });
  }
}
