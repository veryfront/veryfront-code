/**
 * Interactive mode control for CLI
 *
 * Controls whether the CLI prompts for user input.
 * Non-interactive mode is enabled by CI detection or explicit configuration.
 * Only --yes enables automatic confirmation.
 *
 * @module cli/shared/interactive
 */

import { getEnv } from "veryfront/platform";

let _nonInteractive = false;
let _autoConfirm = false;

export function setNonInteractive(enabled: boolean): void {
  _nonInteractive = enabled;
  if (!enabled) _autoConfirm = false;
}

export function setAutoConfirm(enabled: boolean): void {
  _autoConfirm = enabled;
  if (enabled) _nonInteractive = true;
}

export function isAutoConfirmEnabled(): boolean {
  return _autoConfirm;
}

export function isInteractive(): boolean {
  return !_nonInteractive;
}

export function resetInteractiveMode(): void {
  _nonInteractive = false;
  _autoConfirm = false;
}

const CI_ENV_VARS = ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "JENKINS_URL", "CIRCLECI", "BUILDKITE"];

export function detectCI(): boolean {
  return CI_ENV_VARS.some((v) => {
    const val = getEnv(v);
    return val !== undefined && val !== "" && val !== "0" && val !== "false";
  });
}
