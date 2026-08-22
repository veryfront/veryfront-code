import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { CommonArgs, createArgParser } from "#cli/shared/args";
import { resolveConfigWithAuth, type ResolvedConfig } from "#cli/shared/config";
import {
  createHttpDeployControlPlane,
  type DeployControlPlane,
  type EnvironmentAccessToken,
} from "../../shared/deployment/control-plane.ts";

const getEnvironmentTokenArgsSchema = defineSchema((v) =>
  v.object({
    environment: v.string().min(1),
    projectReference: v.string().min(1).optional(),
    projectDir: v.string().optional(),
  })
);

const EnvironmentTokenArgsSchema = lazySchema(getEnvironmentTokenArgsSchema);

export type EnvironmentTokenOptions = InferSchema<
  ReturnType<typeof getEnvironmentTokenArgsSchema>
>;

export const parseEnvironmentTokenArgs = createArgParser(EnvironmentTokenArgsSchema, {
  environment: CommonArgs.env,
  projectReference: CommonArgs.projectSlug,
  projectDir: CommonArgs.projectDir,
}, { rejectUnknown: true });

type EnvironmentTokenControlPlane = Pick<
  DeployControlPlane,
  "getProject" | "createEnvironmentAccessToken"
>;

export interface EnvironmentTokenDependencies {
  resolveConfig?: (projectDir?: string) => Promise<ResolvedConfig>;
  createControlPlane?: (config: ResolvedConfig) => EnvironmentTokenControlPlane;
}

export async function mintEnvironmentAccessToken(
  options: EnvironmentTokenOptions,
  dependencies: EnvironmentTokenDependencies = {},
): Promise<EnvironmentAccessToken> {
  const resolveConfig = dependencies.resolveConfig ?? resolveConfigWithAuth;
  const createControlPlane = dependencies.createControlPlane ?? createHttpDeployControlPlane;
  const config = await resolveConfig(options.projectDir);
  const projectReference = options.projectReference ?? config.projectSlug;
  const targetConfig = options.projectReference
    ? { ...config, projectId: undefined, projectSlug: projectReference }
    : config;
  const controlPlane = createControlPlane(targetConfig);
  const project = await controlPlane.getProject(projectReference);

  return controlPlane.createEnvironmentAccessToken({
    projectId: project.id,
    environmentName: options.environment,
  });
}
