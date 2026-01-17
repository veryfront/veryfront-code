/**
 * Tests for OptimizedImage Component
 */

import { assertEquals, assertExists } from "@std/assert";
import React from "react";
import {
  generateBlurDataURL,
  getAspectRatioPadding,
  OptimizedBackgroundImage,
  OptimizedImage,
  ResponsiveImageContainer,
  SimpleOptimizedImage,
  useOptimizedImage,
} from "@veryfront/components";

Deno.test("OptimizedImage - basic props", () => {
  const props = {
    src: "/images/hero.jpg",
    alt: "Hero image",
    width: 1920,
    height: 1080,
  };

  const element = React.createElement(OptimizedImage, props);

  assertExists(element);
  assertEquals(element.type, OptimizedImage);
  assertEquals(element.props.src, "/images/hero.jpg");
  assertEquals(element.props.alt, "Hero image");
  assertEquals(element.props.width, 1920);
  assertEquals(element.props.height, 1080);
});

Deno.test("OptimizedImage - with custom formats", () => {
  const props = {
    src: "/images/photo.jpg",
    alt: "Photo",
    formats: ["avif", "webp", "jpeg"] as const,
    quality: 85,
  };

  const element = React.createElement(OptimizedImage, props as any);

  assertExists(element);
  assertEquals((element.props as any).formats, ["avif", "webp", "jpeg"]);
  assertEquals((element.props as any).quality, 85);
});

Deno.test("OptimizedImage - priority loading", () => {
  const props = {
    src: "/images/hero.jpg",
    alt: "Hero",
    priority: true,
  };

  const element = React.createElement(OptimizedImage, props);

  assertExists(element);
  assertEquals(element.props.priority, true);
});

Deno.test("OptimizedImage - lazy loading", () => {
  const props = {
    src: "/images/below-fold.jpg",
    alt: "Below fold",
    loading: "lazy" as const,
  };

  const element = React.createElement(OptimizedImage, props);

  assertExists(element);
  assertEquals(element.props.loading, "lazy");
});

Deno.test("OptimizedImage - with blur placeholder", () => {
  const blurDataURL = generateBlurDataURL(10, 10, "#cccccc");

  const props = {
    src: "/images/photo.jpg",
    alt: "Photo",
    placeholder: "blur" as const,
    blurDataURL,
  };

  const element = React.createElement(OptimizedImage, props);

  assertExists(element);
  assertEquals(element.props.placeholder, "blur");
  assertEquals(typeof element.props.blurDataURL, "string");
});

Deno.test("SimpleOptimizedImage - basic props", () => {
  const props = {
    src: "/images/simple.jpg",
    alt: "Simple image",
    format: "webp" as const,
    quality: 80,
  };

  const element = React.createElement(SimpleOptimizedImage, props);

  assertExists(element);
  assertEquals(element.props.src, "/images/simple.jpg");
  assertEquals(element.props.alt, "Simple image");
  assertEquals(element.props.format, "webp");
  assertEquals(element.props.quality, 80);
});

Deno.test("OptimizedBackgroundImage - basic props", () => {
  const props = {
    src: "/images/background.jpg",
    format: "webp" as const,
    quality: 80,
    children: React.createElement("h1", {}, "Title"),
  };

  const element = React.createElement(OptimizedBackgroundImage, props);

  assertExists(element);
  assertEquals(element.props.src, "/images/background.jpg");
  assertEquals(element.props.format, "webp");
});

Deno.test("useOptimizedImage - basic usage", () => {
  const { sources, fallback } = useOptimizedImage("/images/test.jpg");

  assertExists(sources);
  assertExists(fallback);
  assertEquals(Array.isArray(sources), true);
  assertEquals(typeof fallback, "string");
});

Deno.test("useOptimizedImage - custom options", () => {
  const { sources, fallback: _fallback } = useOptimizedImage("/images/test.jpg", {
    formats: ["webp", "jpeg"],
    quality: 90,
  });

  assertExists(sources);
  assertEquals(sources.length, 2);
  assertEquals(sources[0]?.format, "webp");
  assertEquals(sources[1]?.format, "jpeg");
});

Deno.test("generateBlurDataURL - basic", () => {
  const dataURL = generateBlurDataURL();

  assertExists(dataURL);
  assertEquals(dataURL.startsWith("data:image/svg+xml;base64,"), true);
});

Deno.test("generateBlurDataURL - custom dimensions", () => {
  const dataURL = generateBlurDataURL(20, 15, "#ff0000");

  assertExists(dataURL);
  assertEquals(dataURL.startsWith("data:image/svg+xml;base64,"), true);
});

Deno.test("getAspectRatioPadding - 16:9", () => {
  const padding = getAspectRatioPadding(1920, 1080);

  assertEquals(padding, "56.25%"); // 1080/1920 * 100
});

Deno.test("getAspectRatioPadding - 4:3", () => {
  const padding = getAspectRatioPadding(800, 600);

  assertEquals(padding, "75%"); // 600/800 * 100
});

Deno.test("getAspectRatioPadding - 1:1", () => {
  const padding = getAspectRatioPadding(500, 500);

  assertEquals(padding, "100%"); // 500/500 * 100
});

Deno.test("ResponsiveImageContainer - basic props", () => {
  const props = {
    width: 16,
    height: 9,
    children: React.createElement("img", { src: "/test.jpg", alt: "Test" }),
  };

  const element = React.createElement(ResponsiveImageContainer, props);

  assertExists(element);
  assertEquals(element.props.width, 16);
  assertEquals(element.props.height, 9);
});

Deno.test("ResponsiveImageContainer - with className", () => {
  const props = {
    width: 16,
    height: 9,
    className: "image-wrapper",
    children: React.createElement("div", {}, "Content"),
  };

  const element = React.createElement(ResponsiveImageContainer, props);

  assertExists(element);
  assertEquals(element.props.className, "image-wrapper");
});

Deno.test("OptimizedImage - event handlers", () => {
  const onLoad = () => {};
  const onError = () => {};
  const onClick = () => {};

  const props = {
    src: "/images/test.jpg",
    alt: "Test",
    onLoad,
    onError,
    onClick,
  };

  const element = React.createElement(OptimizedImage, props);

  assertExists(element);
  assertEquals(element.props.onLoad, onLoad);
  assertEquals(element.props.onError, onError);
  assertEquals(element.props.onClick, onClick);
});

Deno.test("OptimizedImage - custom sizes", () => {
  const props = {
    src: "/images/test.jpg",
    alt: "Test",
    sizes: "(max-width: 768px) 100vw, 50vw",
  };

  const element = React.createElement(OptimizedImage, props);

  assertExists(element);
  assertEquals(element.props.sizes, "(max-width: 768px) 100vw, 50vw");
});

Deno.test("OptimizedImage - className and style", () => {
  const style = { border: "1px solid red" };

  const props = {
    src: "/images/test.jpg",
    alt: "Test",
    className: "custom-image",
    style,
  };

  const element = React.createElement(OptimizedImage, props);

  assertExists(element);
  assertEquals(element.props.className, "custom-image");
  assertEquals(element.props.style, style);
});
