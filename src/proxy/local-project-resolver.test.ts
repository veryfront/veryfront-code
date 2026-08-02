import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { createLocalProjectResolver } from "./local-project-resolver.ts";

describe("local project resolver", () => {
  it("uses configured local projects without filesystem discovery", async () => {
    const existsCalls: string[] = [];
    const resolver = createLocalProjectResolver({
      localProjects: { storefront: "/configured/storefront" },
      basePath: () => "/workspace",
      fs: {
        exists(path: string): Promise<boolean> {
          existsCalls.push(path);
          return Promise.resolve(false);
        },
      },
    });

    const path = await resolver.find("storefront");

    assertEquals(path, "/configured/storefront");
    assertEquals(existsCalls, []);
  });

  it("discovers projects with Veryfront source markers and caches per workspace", async () => {
    const workspaceA = "/workspace-a";
    const workspaceB = "/workspace-b";
    const existingPaths = new Set([
      `${workspaceA}/projects/shop`,
      `${workspaceA}/projects/shop/app`,
      `${workspaceB}/projects/shop`,
    ]);
    const existsCalls: string[] = [];
    const fs = {
      exists(path: string): Promise<boolean> {
        existsCalls.push(path);
        return Promise.resolve(existingPaths.has(path));
      },
    };

    const resolverA = createLocalProjectResolver({
      localProjects: {},
      basePath: () => workspaceA,
      fs,
    });

    const firstPath = await resolverA.find("shop");
    existsCalls.length = 0;
    const cachedPath = await resolverA.find("shop");

    assertEquals(firstPath, `${workspaceA}/projects/shop`);
    assertEquals(cachedPath, `${workspaceA}/projects/shop`);
    assertEquals(existsCalls, []);

    const resolverB = createLocalProjectResolver({
      localProjects: {},
      basePath: () => workspaceB,
      fs,
    });

    const workspaceBPath = await resolverB.find("shop");

    assertEquals(workspaceBPath, undefined);
  });

  it("discovers a project whose source roots are declared in config", async () => {
    const workspace = "/workspace-custom-roots";
    const existingPaths = new Set([
      `${workspace}/projects/shop`,
      `${workspace}/projects/shop/veryfront.config.js`,
    ]);
    const resolver = createLocalProjectResolver({
      basePath: () => workspace,
      fs: {
        exists(path: string): Promise<boolean> {
          return Promise.resolve(existingPaths.has(path));
        },
      },
    });

    assertEquals(await resolver.find("shop"), `${workspace}/projects/shop`);
  });

  it("rejects traversal-shaped slugs before filesystem access", async () => {
    const existsCalls: string[] = [];
    const resolver = createLocalProjectResolver({
      basePath: () => "/workspace",
      fs: {
        exists(path: string): boolean {
          existsCalls.push(path);
          return true;
        },
      },
    });

    assertEquals(await resolver.find("../../private"), undefined);
    assertEquals(existsCalls, []);
  });

  it("does not read inherited configured project entries", async () => {
    const localProjects = Object.create({ inherited: "/private" }) as Record<string, string>;
    const resolver = createLocalProjectResolver({
      localProjects,
      allowDiscovery: false,
    });

    assertEquals(await resolver.find("inherited"), undefined);
  });

  it("surfaces operational filesystem failures", async () => {
    const resolver = createLocalProjectResolver({
      basePath: () => "/workspace",
      fs: {
        exists(): boolean {
          throw new Error("permission denied");
        },
      },
    });

    await assertRejects(() => resolver.find("shop"), Error, "permission denied");
  });

  it("keeps discovery caches isolated by resolver ownership", async () => {
    const first = createLocalProjectResolver({
      basePath: () => "/workspace",
      fs: {
        exists(path: string): boolean {
          return path === "/workspace/projects/shop" ||
            path === "/workspace/projects/shop/app";
        },
      },
    });
    const second = createLocalProjectResolver({
      basePath: () => "/workspace",
      fs: { exists: () => false },
    });

    assertEquals(await first.find("shop"), "/workspace/projects/shop");
    assertEquals(await second.find("shop"), undefined);
  });

  it("can disable implicit filesystem discovery", async () => {
    let existsCalls = 0;
    const resolver = createLocalProjectResolver({
      allowDiscovery: false,
      fs: {
        exists(): boolean {
          existsCalls++;
          return true;
        },
      },
    });

    assertEquals(await resolver.find("shop"), undefined);
    assertEquals(existsCalls, 0);
  });
});
