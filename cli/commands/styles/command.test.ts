import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_CSS_PIPELINE_IDENTITY_CODE_UNITS } from "#veryfront/utils";
import {
  createAcknowledgedStyleArtifactBuildResult,
  getUnderlyingVeryfrontClient,
  normalizeStyleArtifactBuildConfigInput,
  parseStyleArtifactBuildConfig,
} from "./command.ts";
import {
  createStyleArtifactTuple,
  STYLE_ARTIFACT_CONTENT_TYPE,
} from "#veryfront/platform/adapters/veryfront-api-client/index.ts";

describe("createAcknowledgedStyleArtifactBuildResult", () => {
  const artifactHash = "b".repeat(64);
  const tuple = createStyleArtifactTuple({
    cssPipelineIdentity: "pipeline@1",
    styleProfileHash: "a".repeat(64),
    branch: "main",
  });

  it("uses only the exact ready acknowledgement metadata", () => {
    assertEquals(
      createAcknowledgedStyleArtifactBuildResult(
        tuple,
        { branch: "main", type: "branch", value: "main" },
        artifactHash,
        {
          ...tuple,
          status: "ready",
          artifactHash,
          assetPath: `/_vf/css/${artifactHash}.css`,
          contentType: STYLE_ARTIFACT_CONTENT_TYPE,
          etag: `"${artifactHash}"`,
        },
      ),
      {
        kind: "style_artifact",
        status: "ready",
        css_pipeline_identity: "pipeline@1",
        style_profile_hash: "a".repeat(64),
        artifact_hash: artifactHash,
        asset_path: `/_vf/css/${artifactHash}.css`,
        content_type: STYLE_ARTIFACT_CONTENT_TYPE,
        etag: `"${artifactHash}"`,
        selector: { type: "branch", value: "main" },
      },
    );
  });

  it("does not fabricate an acknowledgement for missing or mismatched results", () => {
    assertThrows(() =>
      createAcknowledgedStyleArtifactBuildResult(
        tuple,
        { branch: "main", type: "branch", value: "main" },
        artifactHash,
        { ...tuple, status: "missing" },
      )
    );
    assertThrows(() =>
      createAcknowledgedStyleArtifactBuildResult(
        tuple,
        { branch: "main", type: "branch", value: "main" },
        artifactHash,
        {
          ...tuple,
          status: "ready",
          artifactHash: "c".repeat(64),
          assetPath: `/_vf/css/${"c".repeat(64)}.css`,
          contentType: STYLE_ARTIFACT_CONTENT_TYPE,
          etag: `"${"c".repeat(64)}"`,
        },
      )
    );
  });
});

describe("getUnderlyingVeryfrontClient", () => {
  it("binds getAllSourceFiles to the underlying adapter", async () => {
    const files = [{ path: "pages/index.tsx", content: "export default function Page() {}" }];
    const client = { id: "client" };
    const underlyingAdapter = {
      files,
      getAllSourceFiles() {
        return Promise.resolve(this.files);
      },
      getContentContext() {
        return { sourceType: "branch" as const, branch: "main" };
      },
      getClient() {
        return client;
      },
    };

    const sourceAdapter = getUnderlyingVeryfrontClient({
      fs: {
        isVeryfrontAdapter() {
          return true;
        },
        getUnderlyingAdapter() {
          return underlyingAdapter;
        },
        isMultiProjectMode() {
          return false;
        },
      },
    } as never);

    assertEquals(sourceAdapter.client, client as never);
    assertEquals(sourceAdapter.contentContext, { sourceType: "branch", branch: "main" });
    assertEquals(await sourceAdapter.getAllSourceFiles(), files);
  });
});

describe("normalizeStyleArtifactBuildConfigInput", () => {
  it("uses the webhook payload as the style build config", () => {
    assertEquals(
      normalizeStyleArtifactBuildConfigInput({
        source: "webhook",
        payload: { branch: "main", style_profile_hash: "profile-1" },
        webhook_id: "whk_example",
      }),
      { branch: "main", style_profile_hash: "profile-1" },
    );
  });

  it("leaves direct style build config unchanged", () => {
    assertEquals(
      normalizeStyleArtifactBuildConfigInput({ branch: "main", style_profile_hash: "profile-1" }),
      { branch: "main", style_profile_hash: "profile-1" },
    );
  });
});

describe("parseStyleArtifactBuildConfig", () => {
  it("accepts canonical pipeline and style-profile identities", () => {
    const cssPipelineIdentity = '["veryfront.css-pipeline.v1","compiler@1"]';
    const styleProfileHash = "a".repeat(64);
    assertEquals(
      parseStyleArtifactBuildConfig(JSON.stringify({
        css_pipeline_identity: cssPipelineIdentity,
        style_profile_hash: styleProfileHash,
        branch: "main",
      })),
      {
        css_pipeline_identity: cssPipelineIdentity,
        style_profile_hash: styleProfileHash,
        branch: "main",
      },
    );
  });

  it("rejects oversized and control-bearing pipeline identities", () => {
    for (
      const cssPipelineIdentity of [
        "x".repeat(MAX_CSS_PIPELINE_IDENTITY_CODE_UNITS + 1),
        "pipeline\nidentity",
      ]
    ) {
      assertThrows(() =>
        parseStyleArtifactBuildConfig(JSON.stringify({
          css_pipeline_identity: cssPipelineIdentity,
          style_profile_hash: "a".repeat(64),
          branch: "main",
        }))
      );
    }
  });

  it("rejects non-canonical style-profile hashes", () => {
    assertThrows(() =>
      parseStyleArtifactBuildConfig(JSON.stringify({
        css_pipeline_identity: "pipeline@1",
        style_profile_hash: "profile-1",
        branch: "main",
      }))
    );
  });

  it("requires the style-profile hash", () => {
    assertThrows(() =>
      parseStyleArtifactBuildConfig(JSON.stringify({
        css_pipeline_identity: "pipeline@1",
        branch: "main",
      }))
    );
  });

  it("requires one canonical selector", () => {
    for (
      const selector of [
        {},
        { branch: "main", environment_name: "Preview" },
        { branch: " main" },
        { release_id: "release\n1" },
      ]
    ) {
      assertThrows(() =>
        parseStyleArtifactBuildConfig(JSON.stringify({
          css_pipeline_identity: "pipeline@1",
          style_profile_hash: "a".repeat(64),
          ...selector,
        }))
      );
    }
  });
});
