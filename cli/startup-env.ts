interface CliEnvironmentDependencies {
  hasEnvLoaded(): boolean;
  supportsEnvFiles(): boolean;
  loadEnv(): Promise<void>;
  markEnvLoaded(): void;
  initializeEnvironmentConfig(): void | Promise<void>;
}

/**
 * Load environment files before initializing CLI configuration.
 *
 * `loadEnv` treats missing files as optional. Other failures propagate so the
 * CLI never starts with an incomplete environment or marks a failed load as
 * complete.
 */
export async function initializeCliEnvironment(
  dependencies: CliEnvironmentDependencies,
): Promise<void> {
  if (!dependencies.hasEnvLoaded()) {
    if (dependencies.supportsEnvFiles()) {
      await dependencies.loadEnv();
    } else {
      dependencies.markEnvLoaded();
    }
  }

  await dependencies.initializeEnvironmentConfig();
}
