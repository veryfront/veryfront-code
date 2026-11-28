// Cold installation groups retain their existing 25-second child budget.
// Keep at most two cold project installations per group; every executor binds port 8081.
export const executorBootstrapInstallations = [
  ["runtime", false, undefined],
  ["runtime", true, undefined],
  ["project-tools", false, undefined],
  ["project-tools", true, "a"],
  ["project-tools", true, "b"],
  ["project-tools", true, "retained"],
  ["project-tools", true, "missing"],
  ["project-tools", true, "mismatch"],
  ["project-tools", true, "reserved"],
  ["http", false, undefined],
] as const;

export function executorBootstrapInstallationName(
  [profile, selectedSource, scenario]: typeof executorBootstrapInstallations[number],
): string {
  const selection = selectedSource
    ? ` selected-source${scenario ? " captured-" + scenario : ""}`
    : "";
  return `loads a real project only after fixed ${profile}${selection} installation`;
}

/** One manifest owns the filtering and exact completion counts for integration and coverage. */
export function executorBootstrapTestGroups(): readonly {
  name: string;
  pattern: string;
  expectedTests: number;
}[] {
  const installation = "loads a real project only after fixed";
  return [
    {
      name: "runtime installation",
      pattern: `${installation} runtime(?: selected-source)? installation$`,
      expectedTests: 2,
    },
    {
      name: "project-tools legacy and captured A",
      pattern: `${installation} project-tools(?: selected-source captured-a)? installation$`,
      expectedTests: 2,
    },
    {
      name: "project-tools updated and retained",
      pattern:
        `${installation} project-tools selected-source captured-(?:b|retained) installation$`,
      expectedTests: 2,
    },
    {
      name: "project-tools missing and mismatched",
      pattern:
        `${installation} project-tools selected-source captured-(?:missing|mismatch) installation$`,
      expectedTests: 2,
    },
    {
      name: "project-tools reserved settings",
      pattern: `${installation} project-tools selected-source captured-reserved installation$`,
      expectedTests: 1,
    },
    { name: "HTTP installation", pattern: `${installation} http installation$`, expectedTests: 1 },
    {
      name: "bootstrap and TLS channel",
      pattern:
        `^fixed Node executor bootstrap (?!${installation} (?:runtime(?: selected-source)?|project-tools(?: selected-source(?: captured-[a-z]+)?)?|http) installation$).+`,
      expectedTests: 22,
    },
  ];
}
