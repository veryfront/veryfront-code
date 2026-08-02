export type DependencyArtifactContentType = "text/javascript" | "text/css";

export const DEPENDENCY_ARTIFACT_BUILD_CAPABILITY = "dependency-artifact-build-v1" as const;

export interface DependencyArtifactIdentity {
  origin_key: "npm:public";
  package_name: string;
  exact_version: string;
  subpath: string;
  target: "es2022";
  profile: "standard-v1" | "react-v1" | "react-dom-v1";
}

export type DependencyArtifactPolicyDecision =
  | { decision: "allow" }
  | { decision: "deny"; reason_code: string }
  | {
    decision: "too_young";
    reason_code: string;
    retry_after: string;
  };

export interface DependencyArtifactBuildTaskInput {
  artifact_id: string;
  attempt_count: number;
  identity: DependencyArtifactIdentity;
  policy: DependencyArtifactPolicyDecision;
}

export type DependencyArtifactBuildResultBody =
  | {
    outcome: "ready";
    // The authenticated attempt lease owns the canonical identity, key/profile,
    // policy decision, and timestamps. The API combines that durable metadata
    // with this strictly verified publication payload.
    graph: {
      graph_schema_version: 1;
      root_content_hash: string;
      assets: Array<{
        content_hash: string;
        content_type: DependencyArtifactContentType;
        size: number;
      }>;
    };
  }
  | {
    outcome: "failed";
    failure_code: string;
    failure_message?: string;
    retry_after?: string;
  };
