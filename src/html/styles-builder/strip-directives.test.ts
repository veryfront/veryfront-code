import { assertEquals } from "@std/assert";
import { stripTailwindBuildDirectives } from "./strip-directives.ts";

Deno.test("stripTailwindBuildDirectives - strips @import tailwindcss", () => {
  const input = `@import "tailwindcss";
.foo { color: red; }`;
  const expected = `.foo { color: red; }`;
  assertEquals(stripTailwindBuildDirectives(input), expected);
});

Deno.test("stripTailwindBuildDirectives - strips @plugin", () => {
  const input = `@plugin "@tailwindcss/typography";
.foo { color: red; }`;
  const expected = `.foo { color: red; }`;
  assertEquals(stripTailwindBuildDirectives(input), expected);
});

Deno.test("stripTailwindBuildDirectives - strips @source", () => {
  const input = `@source "../src/**/*.tsx";
.foo { color: red; }`;
  const expected = `.foo { color: red; }`;
  assertEquals(stripTailwindBuildDirectives(input), expected);
});

Deno.test("stripTailwindBuildDirectives - strips @theme block", () => {
  const input = `@theme {
  --color-primary: #ff0000;
}
.foo { color: red; }`;
  const expected = `.foo { color: red; }`;
  assertEquals(stripTailwindBuildDirectives(input), expected);
});

Deno.test("stripTailwindBuildDirectives - strips @custom-variant inline", () => {
  const input = `@custom-variant dark (&:where(.dark, .dark *));
.foo { color: red; }`;
  const result = stripTailwindBuildDirectives(input);
  assertEquals(result.includes("@custom-variant"), false);
  assertEquals(result.includes(".foo { color: red; }"), true);
});

Deno.test("stripTailwindBuildDirectives - strips @variant block", () => {
  const input = `.element {
  background: white;
  @variant dark {
    background: black;
  }
}`;
  const result = stripTailwindBuildDirectives(input);
  assertEquals(result.includes("@variant"), false);
});

Deno.test("stripTailwindBuildDirectives - strips @utility with nested braces", () => {
  const input = `@utility contain-layout {
  contain: layout;
}

@utility isometric {
  transform: matrix(0.95, -0.33, 0.75, 0.66, 0, 0);
  transition: transform 0.4s ease-in-out;

  &.normal {
    transform: none;
  }
}

.foo { color: red; }`;
  const result = stripTailwindBuildDirectives(input);
  assertEquals(result.includes("@utility"), false);
  assertEquals(result.includes(".foo { color: red; }"), true);
});

Deno.test("stripTailwindBuildDirectives - strips @tailwind directives (v3)", () => {
  const input = `@tailwind base;
@tailwind components;
@tailwind utilities;
.foo { color: red; }`;
  const expected = `.foo { color: red; }`;
  assertEquals(stripTailwindBuildDirectives(input), expected);
});

Deno.test("stripTailwindBuildDirectives - strips @config (v3)", () => {
  const input = `@config "./tailwind.config.js";
.foo { color: red; }`;
  const expected = `.foo { color: red; }`;
  assertEquals(stripTailwindBuildDirectives(input), expected);
});

Deno.test("stripTailwindBuildDirectives - preserves regular CSS", () => {
  const input = `[data-theme="dark"] {
  --background: 208 21% 12%;
  --foreground: 0 0% 100%;
}

html {
  text-rendering: optimizeLegibility;
}`;
  const result = stripTailwindBuildDirectives(input);
  assertEquals(result.includes('[data-theme="dark"]'), true);
  assertEquals(result.includes("--background: 208 21% 12%"), true);
  assertEquals(result.includes("html"), true);
});

Deno.test("stripTailwindBuildDirectives - handles complex globals.css", () => {
  const input = `@import "tailwindcss";
@plugin "@tailwindcss/typography";
@source "../src/**/*.tsx";

@theme {
  --color-primary: #ff0000;
}

[data-theme="dark"] {
  --background: 208 21% 12%;
}

@utility contain-layout {
  contain: layout;
}

@utility isometric {
  transform: matrix(0.95, -0.33, 0.75, 0.66, 0, 0);

  &.normal {
    transform: none;
  }
}

html {
  text-rendering: optimizeLegibility;
}`;

  const result = stripTailwindBuildDirectives(input);

  // Should not contain build-time directives
  assertEquals(result.includes("@import"), false);
  assertEquals(result.includes("@plugin"), false);
  assertEquals(result.includes("@source"), false);
  assertEquals(result.includes("@theme"), false);
  assertEquals(result.includes("@utility"), false);

  // Should preserve regular CSS
  assertEquals(result.includes('[data-theme="dark"]'), true);
  assertEquals(result.includes("--background: 208 21% 12%"), true);
  assertEquals(result.includes("html"), true);
  assertEquals(result.includes("text-rendering: optimizeLegibility"), true);
});
