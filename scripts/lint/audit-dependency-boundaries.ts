import {
  type DependencyIndex,
  dependencyIndexForAllManifests,
  type DependencyIndexManifest,
  importsByWorkspaceManifest,
  workspaceMembersFromDenoConfig,
} from "../build/generate-sbom.ts";

export interface DependencyBoundaryAuditIssue {
  boundary: string;
  message: string;
}

const REACT_BOUNDARY_COMPONENTS = new Set([
  "@types/react",
  "@types/react-dom",
  "csstype",
  "react",
  "react-dom",
]);

function componentNames(
  manifest: DependencyIndexManifest | undefined,
): string[] {
  return (manifest?.components ?? []).map((component) => component.name)
    .toSorted();
}

function manifestBySourceLocation(
  index: DependencyIndex,
): Map<string, DependencyIndexManifest> {
  return new Map(
    index.manifests.map((manifest) => [manifest.sourceLocation, manifest]),
  );
}

function formatNames(names: string[]): string {
  return names.length === 0 ? "none" : names.join(", ");
}

export function auditDependencyBoundaries(
  index: DependencyIndex,
): DependencyBoundaryAuditIssue[] {
  const manifests = manifestBySourceLocation(index);
  const issues: DependencyBoundaryAuditIssue[] = [];

  for (
    const [sourceLocation, boundary] of [
      ["deno.json", "core"],
      ["cli/deno.json", "cli"],
    ] as const
  ) {
    const manifest = manifests.get(sourceLocation);
    if (!manifest) {
      issues.push({
        boundary,
        message: `${boundary} boundary is missing from dependency index`,
      });
      continue;
    }

    if (manifest.componentCount !== 0) {
      issues.push({
        boundary,
        message:
          `${boundary} boundary must have 0 third-party npm components, found ${manifest.componentCount}: ${
            formatNames(componentNames(manifest))
          }`,
      });
    }
  }

  const react = manifests.get("react/deno.json");
  if (!react) {
    issues.push({
      boundary: "react",
      message: "react boundary is missing from dependency index",
    });
  } else {
    const reactNames = new Set(componentNames(react));
    for (const expectedComponent of REACT_BOUNDARY_COMPONENTS) {
      if (!reactNames.has(expectedComponent)) {
        issues.push({
          boundary: "react",
          message:
            `react boundary is missing expected component ${expectedComponent}`,
        });
      }
    }
  }

  return issues;
}

async function dependencyIndexFromWorkspace(): Promise<DependencyIndex> {
  const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
  const workspaceMembers = workspaceMembersFromDenoConfig(denoConfig);
  return dependencyIndexForAllManifests(await Deno.readTextFile("deno.lock"), {
    workspaceMembers,
    reactImports: denoConfig.imports ?? {},
    manifestImportsByPath: await importsByWorkspaceManifest(workspaceMembers),
  });
}

if (import.meta.main) {
  const issues = auditDependencyBoundaries(
    await dependencyIndexFromWorkspace(),
  );

  if (issues.length === 0) {
    console.log(
      "Dependency boundaries verified: core=0, cli=0, react isolated.",
    );
    Deno.exit(0);
  }

  console.error(`${issues.length} dependency boundary issue(s):`);
  for (const issue of issues) {
    console.error(`  ${issue.boundary}: ${issue.message}`);
  }
  Deno.exit(1);
}
