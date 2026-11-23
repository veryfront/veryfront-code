// Cold installation groups retain their existing 25-second child budget.
// Runtime and project-tools groups cover legacy and selected-source installations. Run groups
// serially: every executor binds the same fixed port, 8081.
export function executorBootstrapTestPatterns(): readonly string[] {
  const installation = "loads a real project only after fixed";
  return [
    `${installation} runtime(?: selected-source)? installation$`,
    `${installation} project-tools(?: selected-source)? installation$`,
    `${installation} http installation$`,
    `^fixed Node executor bootstrap (?!${installation} (?:runtime(?: selected-source)?|project-tools(?: selected-source)?|http) installation$).+`,
  ];
}
