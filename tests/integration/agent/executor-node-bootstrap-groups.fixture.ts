// Each cold installation owns its existing 25-second child budget. Run the
// groups serially: every executor binds the same fixed port, 8081.
export function executorBootstrapTestPatterns(): readonly string[] {
  const installation = "loads a real project only after fixed";
  return [
    `${installation} runtime installation$`,
    `${installation} project-tools installation$`,
    `${installation} http installation$`,
    `^fixed Node executor bootstrap (?!${installation} (?:runtime|project-tools|http) installation$).+`,
  ];
}
