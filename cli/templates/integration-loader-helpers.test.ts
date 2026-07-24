import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  generateAtlassianOAuthFiles,
  isAtlassianProductCallbackPath,
} from "./atlassian-oauth-composition.ts";
import {
  buildIntegrationDirectory,
  buildUnknownIntegrationErrors,
  mergeIntegrationFiles,
  namespaceIntegrationTemplateFiles,
  resolveIntegrationModuleDir,
} from "./integration-loader-helpers.ts";
import type { IntegrationName, TemplateFile } from "./types.ts";

type TemplateManifest = {
  templates: Record<string, { files: Record<string, string> }>;
};

function manifestFiles(
  manifest: TemplateManifest,
  templateName: string,
): TemplateFile[] {
  const template = manifest.templates[templateName];
  if (!template) throw new Error(`Missing template manifest entry: ${templateName}`);
  return Object.entries(template.files).map(([path, content]) => ({
    path,
    content,
  }));
}

describe("cli/templates/integration-loader-helpers", () => {
  it("resolves file module directories for unix and windows paths", () => {
    assertEquals(
      resolveIntegrationModuleDir(
        "file:///Users/test/veryfront-code/cli/templates/integration-loader.ts",
      ),
      "/Users/test/veryfront-code/cli/templates/",
    );
    assertEquals(
      resolveIntegrationModuleDir(
        "file:///C:/veryfront/cli/templates/integration-loader.ts",
        "win32",
      ),
      "C:/veryfront/cli/templates/",
    );
  });

  it("builds integration directories from the module directory", () => {
    assertEquals(
      buildIntegrationDirectory("/Users/test/veryfront-code/cli/templates/", "github"),
      "/Users/test/veryfront-code/cli/templates/integrations/github",
    );
  });

  it("reports unknown integrations with a stable available list", () => {
    assertEquals(
      buildUnknownIntegrationErrors(
        ["github", "unknown"] as Array<"github" | "unknown"> as any,
        ["github", "slack"] as any,
      ),
      ["Unknown integration: unknown. Available: github, slack"],
    );
  });

  it("namespaces generated tool paths and preserves provider env examples", () => {
    const merged = namespaceIntegrationTemplateFiles("github", [
      { path: "tools/get-issue.ts", content: "tool" } as any,
      { path: ".env.example", content: "GITHUB_CLIENT_ID=" } as any,
      { path: "lib/github-client.ts", content: "client" } as any,
    ]);
    assertEquals(
      merged.map((file) => [file.path, file.content]),
      [
        ["tools/github-get-issue.ts", "tool"],
        ["examples/env/github.env.example", "GITHUB_CLIENT_ID="],
        ["lib/github-client.ts", "client"],
      ],
    );
  });

  it("rejects invalid namespaces and nested integration tool paths", () => {
    assertThrows(
      () =>
        namespaceIntegrationTemplateFiles(
          "GitHub" as IntegrationName,
          [],
        ),
      Error,
      "Invalid integration template namespace",
    );
    assertThrows(
      () =>
        namespaceIntegrationTemplateFiles("github", [
          {
            path: "tools/admin/get-issue.ts",
            content: "tool",
          },
        ]),
      Error,
      "must be direct children",
    );
  });

  it("keeps every catalog integration collision-free with resolvable relative imports", async () => {
    const manifest = JSON.parse(
      await Deno.readTextFile(
        new URL("./manifest.json", import.meta.url),
      ),
    ) as TemplateManifest;
    const integrationNames = Object.keys(manifest.templates)
      .filter((name) => name.startsWith("integration:") && name !== "integration:_base")
      .map((name) => name.slice("integration:".length) as IntegrationName);
    const integrationFileSets = integrationNames.map((name) => ({
      files: namespaceIntegrationTemplateFiles(
        name,
        manifestFiles(manifest, `integration:${name}`),
      ).filter((file) => !isAtlassianProductCallbackPath(file.path)),
    }));
    const merged = mergeIntegrationFiles([
      { files: manifestFiles(manifest, "integration:_base") },
      ...integrationFileSets,
      { files: generateAtlassianOAuthFiles(["jira", "confluence"]) },
    ]);
    const outputPaths = new Set(merged.map((file) => file.path));

    for (const file of merged) {
      if (!file.path.endsWith(".ts") && !file.path.endsWith(".tsx")) continue;
      for (
        const match of file.content.matchAll(
          /(?:\bfrom\s+|\bimport\s*\()\s*["'](\.[^"']+)["']/g,
        )
      ) {
        const specifier = match[1]!;
        const resolvedUrl = new URL(
          specifier,
          `file:///generated-project/${file.path}`,
        );
        assertEquals(
          resolvedUrl.pathname.startsWith("/generated-project/"),
          true,
          `${file.path} import ${specifier} escapes the generated project`,
        );
        const resolvedPath = resolvedUrl.pathname.slice(
          "/generated-project/".length,
        );
        const candidates = [
          resolvedPath,
          `${resolvedPath}.ts`,
          `${resolvedPath}.tsx`,
          `${resolvedPath}/index.ts`,
          `${resolvedPath}/index.tsx`,
        ];
        assertEquals(
          candidates.some((candidate) => outputPaths.has(candidate)),
          true,
          `${file.path} import ${specifier} does not resolve to ${resolvedPath}`,
        );
      }
    }
  });

  it("rejects unresolved integration file collisions", () => {
    assertThrows(
      () =>
        mergeIntegrationFiles([
          { files: [{ path: "lib/a.ts", content: "old" } as any] },
          { files: [{ path: "lib/a.ts", content: "new" } as any] },
        ]),
      Error,
      "lib/a.ts",
    );
  });
});
