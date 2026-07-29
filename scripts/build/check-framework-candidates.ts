#!/usr/bin/env -S deno run --allow-read

import { dirname, fromFileUrl, join } from "#std/path";
import {
  checkFrameworkCandidateArtifact,
  type FrameworkCandidateArtifactIO,
} from "./framework-candidates.ts";

const defaultProjectRoot = join(
  dirname(fromFileUrl(import.meta.url)),
  "..",
  "..",
);

export interface FrameworkCandidateCheckReporter {
  readonly log: (message: string) => void;
  readonly error: (message: string) => void;
}

export interface FrameworkCandidateCheckOptions {
  readonly projectRoot?: string;
  readonly artifactPath?: string;
  readonly io?: FrameworkCandidateArtifactIO;
  readonly reporter?: FrameworkCandidateCheckReporter;
}

const defaultReporter: FrameworkCandidateCheckReporter = {
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

function defaultArtifactPath(projectRoot: string): string {
  return join(
    projectRoot,
    "src",
    "server",
    "handlers",
    "dev",
    "framework-candidates.generated.ts",
  );
}

export async function runFrameworkCandidatesCheck(
  options: FrameworkCandidateCheckOptions = {},
): Promise<0 | 1> {
  const projectRoot = options.projectRoot ?? defaultProjectRoot;
  const reporter = options.reporter ?? defaultReporter;
  const artifactPath = options.artifactPath ?? defaultArtifactPath(projectRoot);
  const result = await checkFrameworkCandidateArtifact(
    projectRoot,
    artifactPath,
    options.io,
  );

  if (result.status === "current") {
    reporter.log(
      `[framework-candidates] Current (${result.candidateCount} candidates).`,
    );
    return 0;
  }

  if (result.status === "missing") {
    reporter.error(
      "[framework-candidates] Missing: tracked artifact was not found.",
    );
  } else {
    reporter.error(
      `[framework-candidates] Stale: canonical bytes differ at offset ${result.firstDifferenceOffset}.`,
    );
  }
  reporter.error(
    "[framework-candidates] Regenerate with `deno task generate`.",
  );
  return 1;
}

if (import.meta.main) {
  Deno.exitCode = await runFrameworkCandidatesCheck();
}
