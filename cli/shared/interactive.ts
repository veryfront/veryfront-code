/**
 * Interactive mode control for CLI
 *
 * Controls whether the CLI prompts for user input.
 * Non-interactive mode is enabled by --yes flag or CI detection.
 *
 * @module cli/shared/interactive
 */

import { getEnv } from "veryfront/platform";

let _nonInteractive = false;

export function setNonInteractive(enabled: boolean): void {
  _nonInteractive = enabled;
}

export function isInteractive(): boolean {
  return !_nonInteractive;
}

export function resetInteractiveMode(): void {
  _nonInteractive = false;
}

const CI_ENV_VARS = ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "JENKINS_URL", "CIRCLECI", "BUILDKITE"];

export function detectCI(): boolean {
  return CI_ENV_VARS.some((v) => {
    const val = getEnv(v);
    return val !== undefined && val !== "" && val !== "0" && val !== "false";
  });
}
