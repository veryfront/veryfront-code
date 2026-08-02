import type * as React from "react";
import { renderToString } from "react-dom/server";
import { assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { OptimizedImageManifestSnapshot, OptimizedImageMetadata } from "#veryfront/types";
import { ImageManifestProvider, useOptimizedImageMetadata } from "./index.tsx";

const metadata: OptimizedImageMetadata = {
  original: "images/photo.jpg",
  originalSize: 100,
  variants: [{
    format: "webp",
    size: 320,
    width: 320,
    height: 240,
    path: "images/photo-320w-q73.webp",
    fileSize: 42,
    quality: 73,
  }],
  defaultFormat: "webp",
  aspectRatio: 4 / 3,
  engineIdentity: "test-engine@1",
  quality: 73,
};

const manifest: OptimizedImageManifestSnapshot = {
  identity: "a".repeat(64),
  entries: { "images/photo.jpg": metadata },
};

function MetadataProbe(): React.ReactElement {
  const resolved = useOptimizedImageMetadata("/images/photo.jpg");
  return <span>{resolved.variants[0]?.path}</span>;
}

describe("ImageManifestProvider", () => {
  it("resolves validated metadata through the public context barrel", () => {
    const html = renderToString(
      <ImageManifestProvider manifest={manifest}>
        <MetadataProbe />
      </ImageManifestProvider>,
    );
    assertStringIncludes(html, "images/photo-320w-q73.webp");
  });

  it("fails closed when metadata is requested without a render manifest", () => {
    assertThrows(
      () => renderToString(<MetadataProbe />),
      TypeError,
      "requires ImageManifestProvider",
    );
  });

  it("rejects explicit metadata that disagrees with the build manifest", () => {
    function MismatchProbe(): React.ReactElement {
      useOptimizedImageMetadata("/images/photo.jpg", {
        ...metadata,
        quality: 74,
        variants: metadata.variants.map((variant) => ({
          ...variant,
          quality: 74,
        })),
      });
      return <span>unreachable</span>;
    }

    assertThrows(
      () =>
        renderToString(
          <ImageManifestProvider manifest={manifest}>
            <MismatchProbe />
          </ImageManifestProvider>,
        ),
      TypeError,
      "does not match build manifest",
    );
  });
});
