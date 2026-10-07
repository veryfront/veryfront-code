const DEPLOYMENT_ARTIFACT_PATTERN = /^\d{14}-[a-f0-9]{12,40}$/;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwn = Object.hasOwn;
const NativeTypeError = TypeError;

/** Snapshots an own deployment artifact data property without invoking accessors or inherited hooks. */
export function snapshotOwnDeploymentArtifactOption(
  options: { readonly deploymentArtifact?: string | null },
): string | null {
  const descriptor = getOwnPropertyDescriptor(options, "deploymentArtifact");
  if (!descriptor || !objectHasOwn(descriptor, "value")) {
    return null;
  }
  return normalizeDeploymentArtifact(descriptor.value);
}

export function normalizeDeploymentArtifact(deploymentArtifact: unknown): string | null {
  if (deploymentArtifact === undefined || deploymentArtifact === null) return null;
  if (
    typeof deploymentArtifact !== "string" ||
    !DEPLOYMENT_ARTIFACT_PATTERN.test(deploymentArtifact)
  ) {
    throw new NativeTypeError(
      "Agent service deploymentArtifact must be null or an immutable artifact tag formatted as yyyymmddHHMMSS-12-to-40-lowercase-hex.",
    );
  }
  return deploymentArtifact;
}
