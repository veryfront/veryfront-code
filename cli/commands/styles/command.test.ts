import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getUnderlyingVeryfrontClient, normalizeStyleArtifactBuildConfigInput } from "./command.ts";

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
        return { branch: "main" };
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
    assertEquals(sourceAdapter.contentContext, { branch: "main" });
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
