import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ssrHttpStubPlugin } from "./ssr-http-stub.ts";
import { TransformStage } from "../types.ts";

describe("ssrHttpStubPlugin", () => {
  it("has correct name and stage", () => {
    assertEquals(ssrHttpStubPlugin.name, "ssr-http-stub");
    assertEquals(ssrHttpStubPlugin.stage, TransformStage.RESOLVE_CONTEXT + 1);
  });

  it("stubs default import from browser-only HTTP module", async () => {
    const code = `import Player from "https://esm.sh/video.js@8";\nconst x = 1;`;
    const result = await ssrHttpStubPlugin.transform({ code } as any);
    assertEquals(typeof result, "string");
    assertEquals(result!.includes("const Player = null"), true);
    assertEquals(result!.includes("SSR stub"), true);
  });

  it("stubs named imports from browser-only HTTP module", async () => {
    const code = `import { Scene, Camera } from "https://esm.sh/three@0.160";\n`;
    const result = await ssrHttpStubPlugin.transform({ code } as any);
    assertEquals(typeof result, "string");
    assertEquals(result!.includes("Scene = null"), true);
    assertEquals(result!.includes("Camera = null"), true);
  });

  it("stubs namespace imports from browser-only HTTP module", async () => {
    const code = `import * as THREE from "https://esm.sh/three@0.160";\n`;
    const result = await ssrHttpStubPlugin.transform({ code } as any);
    assertEquals(typeof result, "string");
    assertEquals(result!.includes("const THREE = {}"), true);
  });

  it("stubs side-effect imports from browser-only HTTP module", async () => {
    const code = `import "https://esm.sh/video.js@8/dist/video-js.css";\n`;
    const result = await ssrHttpStubPlugin.transform({ code } as any);
    assertEquals(typeof result, "string");
    assertEquals(result!.includes("/* SSR stub"), true);
  });

  it("passes through non-HTTP imports unchanged", async () => {
    const code = `import { useState } from "react";\n`;
    const result = await ssrHttpStubPlugin.transform({ code } as any);
    assertEquals(result, code);
  });

  it("passes through HTTP imports for non-browser-only packages", async () => {
    const code = `import { z } from "https://esm.sh/zod@3";\n`;
    const result = await ssrHttpStubPlugin.transform({ code } as any);
    assertEquals(result, code);
  });

  it("handles mixed import (default + named)", async () => {
    const code = `import gsap, { Power2 } from "https://esm.sh/gsap@3";\n`;
    const result = await ssrHttpStubPlugin.transform({ code } as any);
    assertEquals(typeof result, "string");
    assertEquals(result!.includes("gsap = null"), true);
    assertEquals(result!.includes("Power2 = null"), true);
  });

  it("handles aliased named imports", async () => {
    const code = `import { Map as LeafletMap } from "https://esm.sh/leaflet@1";\n`;
    const result = await ssrHttpStubPlugin.transform({ code } as any);
    assertEquals(typeof result, "string");
    assertEquals(result!.includes("LeafletMap = null"), true);
  });
});
