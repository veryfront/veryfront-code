import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { extractCandidates } from "../../../../src/html/styles-builder/tailwind-compiler.ts";

function assertExtractsClasses(content: string, expectedClasses: string[]): void {
  const result = extractCandidates(content);

  for (const cls of expectedClasses) {
    assertEquals(
      result.includes(cls),
      true,
      `Expected to extract "${cls}" from content. Got: [${result.join(", ")}]`,
    );
  }
}

describe("extractCandidates", () => {
  describe("Basic Utilities", () => {
    it("should extract simple utility classes", () => {
      const content = `<div className="mt-4 bg-blue-500 text-white p-2">`;
      assertExtractsClasses(content, ["mt-4", "bg-blue-500", "text-white", "p-2"]);
    });

    it("should extract spacing utilities", () => {
      const content = `className="m-0 mx-auto py-8 px-4 gap-6"`;
      assertExtractsClasses(content, ["m-0", "mx-auto", "py-8", "px-4", "gap-6"]);
    });

    it("should extract sizing utilities", () => {
      const content = `className="w-full h-screen max-w-md min-h-0"`;
      assertExtractsClasses(content, ["w-full", "h-screen", "max-w-md", "min-h-0"]);
    });

    it("should extract typography utilities", () => {
      const content = `className="text-lg font-bold leading-tight tracking-wide"`;
      assertExtractsClasses(content, ["text-lg", "font-bold", "leading-tight", "tracking-wide"]);
    });

    it("should extract display and layout utilities", () => {
      const content = `className="flex grid block hidden inline-flex"`;
      assertExtractsClasses(content, ["flex", "grid", "block", "hidden", "inline-flex"]);
    });

    it("should extract flexbox utilities", () => {
      const content = `className="flex-col items-center justify-between flex-1 shrink-0"`;
      assertExtractsClasses(content, [
        "flex-col",
        "items-center",
        "justify-between",
        "flex-1",
        "shrink-0",
      ]);
    });

    it("should extract grid utilities", () => {
      const content = `className="grid-cols-3 col-span-2 row-start-1 auto-rows-min"`;
      assertExtractsClasses(content, ["grid-cols-3", "col-span-2", "row-start-1", "auto-rows-min"]);
    });
  });

  describe("Negative Values", () => {
    it("should extract negative margin utilities", () => {
      const content = `className="-mt-4 -mb-2 -mx-6 -m-1"`;
      assertExtractsClasses(content, ["-mt-4", "-mb-2", "-mx-6", "-m-1"]);
    });

    it("should extract negative translate utilities", () => {
      const content = `className="-translate-x-1/2 -translate-y-full"`;
      assertExtractsClasses(content, ["-translate-x-1/2", "-translate-y-full"]);
    });

    it("should extract negative rotate utilities", () => {
      const content = `className="-rotate-45 -rotate-90 -rotate-180"`;
      assertExtractsClasses(content, ["-rotate-45", "-rotate-90", "-rotate-180"]);
    });

    it("should extract negative scale utilities", () => {
      const content = `className="-scale-x-100 -scale-y-50"`;
      assertExtractsClasses(content, ["-scale-x-100", "-scale-y-50"]);
    });

    it("should extract negative inset utilities", () => {
      const content = `className="-top-1 -left-2 -inset-x-4 -right-px"`;
      assertExtractsClasses(content, ["-top-1", "-left-2", "-inset-x-4", "-right-px"]);
    });

    it("should extract negative z-index", () => {
      const content = `className="-z-10 -z-50"`;
      assertExtractsClasses(content, ["-z-10", "-z-50"]);
    });

    it("should extract negative order", () => {
      const content = `className="-order-1 -order-last"`;
      assertExtractsClasses(content, ["-order-1", "-order-last"]);
    });

    it("should extract negative skew", () => {
      const content = `className="-skew-x-12 -skew-y-6"`;
      assertExtractsClasses(content, ["-skew-x-12", "-skew-y-6"]);
    });

    it("should extract negative space utilities", () => {
      const content = `className="-space-x-2 -space-y-4"`;
      assertExtractsClasses(content, ["-space-x-2", "-space-y-4"]);
    });

    it("should extract negative letter-spacing", () => {
      const content = `className="-tracking-wider"`;
      assertExtractsClasses(content, ["-tracking-wider"]);
    });

    it("should extract negative indent", () => {
      const content = `className="-indent-4"`;
      assertExtractsClasses(content, ["-indent-4"]);
    });

    it("should extract negative scroll-margin", () => {
      const content = `className="-scroll-m-4 -scroll-mt-8"`;
      assertExtractsClasses(content, ["-scroll-m-4", "-scroll-mt-8"]);
    });
  });

  describe("Important Modifier", () => {
    it("should extract important prefix utilities", () => {
      const content = `className="!mt-4 !text-red-500 !font-bold"`;
      assertExtractsClasses(content, ["!mt-4", "!text-red-500", "!font-bold"]);
    });

    it("should extract important with negative values", () => {
      const content = `className="!-mt-4 !-translate-x-1/2"`;
      assertExtractsClasses(content, ["!-mt-4", "!-translate-x-1/2"]);
    });

    it("should extract important within variants", () => {
      const content = `className="hover:!bg-blue-500 dark:!text-white"`;
      assertExtractsClasses(content, ["hover:!bg-blue-500", "dark:!text-white"]);
    });

    it("should extract important with arbitrary values", () => {
      const content = `className="!w-[200px] !bg-[#ff0000]"`;
      assertExtractsClasses(content, ["!w-[200px]", "!bg-[#ff0000]"]);
    });
  });

  describe("Responsive Variants", () => {
    it("should extract responsive breakpoint variants", () => {
      const content = `className="sm:mt-4 md:mt-6 lg:mt-8 xl:mt-10 2xl:mt-12"`;
      assertExtractsClasses(content, ["sm:mt-4", "md:mt-6", "lg:mt-8", "xl:mt-10", "2xl:mt-12"]);
    });

    it("should extract min/max breakpoint variants", () => {
      const content = `className="min-[320px]:text-sm max-[600px]:hidden"`;
      assertExtractsClasses(content, ["min-[320px]:text-sm", "max-[600px]:hidden"]);
    });

    it("should extract responsive with negative values", () => {
      const content = `className="md:-mt-4 lg:-translate-x-1/2"`;
      assertExtractsClasses(content, ["md:-mt-4", "lg:-translate-x-1/2"]);
    });
  });

  describe("State Variants", () => {
    it("should extract hover/focus/active variants", () => {
      const content = `className="hover:bg-blue-600 focus:ring-2 active:scale-95"`;
      assertExtractsClasses(content, ["hover:bg-blue-600", "focus:ring-2", "active:scale-95"]);
    });

    it("should extract focus-visible and focus-within", () => {
      const content = `className="focus-visible:ring-2 focus-within:border-blue-500"`;
      assertExtractsClasses(content, ["focus-visible:ring-2", "focus-within:border-blue-500"]);
    });

    it("should extract disabled/enabled variants", () => {
      const content = `className="disabled:opacity-50 enabled:cursor-pointer"`;
      assertExtractsClasses(content, ["disabled:opacity-50", "enabled:cursor-pointer"]);
    });

    it("should extract checked/indeterminate variants", () => {
      const content = `className="checked:bg-blue-500 indeterminate:bg-gray-300"`;
      assertExtractsClasses(content, ["checked:bg-blue-500", "indeterminate:bg-gray-300"]);
    });

    it("should extract first/last/odd/even variants", () => {
      const content = `className="first:mt-0 last:mb-0 odd:bg-gray-100 even:bg-white"`;
      assertExtractsClasses(content, [
        "first:mt-0",
        "last:mb-0",
        "odd:bg-gray-100",
        "even:bg-white",
      ]);
    });

    it("should extract first-of-type/last-of-type variants", () => {
      const content = `className="first-of-type:rounded-t last-of-type:rounded-b"`;
      assertExtractsClasses(content, ["first-of-type:rounded-t", "last-of-type:rounded-b"]);
    });

    it("should extract empty/required/invalid/valid variants", () => {
      const content =
        `className="empty:hidden required:border-red-500 invalid:border-red-500 valid:border-green-500"`;
      assertExtractsClasses(content, [
        "empty:hidden",
        "required:border-red-500",
        "invalid:border-red-500",
        "valid:border-green-500",
      ]);
    });

    it("should extract placeholder-shown variant", () => {
      const content = `className="placeholder-shown:text-gray-400"`;
      assertExtractsClasses(content, ["placeholder-shown:text-gray-400"]);
    });

    it("should extract autofill variant", () => {
      const content = `className="autofill:bg-yellow-100"`;
      assertExtractsClasses(content, ["autofill:bg-yellow-100"]);
    });

    it("should extract read-only/read-write variants", () => {
      const content = `className="read-only:bg-gray-100 read-write:bg-white"`;
      assertExtractsClasses(content, ["read-only:bg-gray-100", "read-write:bg-white"]);
    });
  });

  describe("Dark Mode", () => {
    it("should extract dark mode variants", () => {
      const content = `className="dark:bg-gray-800 dark:text-white"`;
      assertExtractsClasses(content, ["dark:bg-gray-800", "dark:text-white"]);
    });

    it("should extract dark mode with other variants", () => {
      const content = `className="dark:hover:bg-gray-700 dark:focus:ring-blue-400"`;
      assertExtractsClasses(content, ["dark:hover:bg-gray-700", "dark:focus:ring-blue-400"]);
    });
  });

  describe("Stacked Variants", () => {
    it("should extract multiple stacked variants", () => {
      const content = `className="dark:hover:bg-gray-700 sm:hover:text-lg lg:focus:ring-2"`;
      assertExtractsClasses(content, [
        "dark:hover:bg-gray-700",
        "sm:hover:text-lg",
        "lg:focus:ring-2",
      ]);
    });

    it("should extract complex stacked variants", () => {
      const content = `className="group-hover:dark:bg-gray-700 peer-checked:dark:text-white"`;
      assertExtractsClasses(content, [
        "group-hover:dark:bg-gray-700",
        "peer-checked:dark:text-white",
      ]);
    });
  });

  describe("Group and Peer Variants", () => {
    it("should extract group variants", () => {
      const content = `className="group-hover:visible group-focus:ring-2"`;
      assertExtractsClasses(content, ["group-hover:visible", "group-focus:ring-2"]);
    });

    it("should extract peer variants", () => {
      const content = `className="peer-checked:bg-blue-500 peer-invalid:border-red-500"`;
      assertExtractsClasses(content, ["peer-checked:bg-blue-500", "peer-invalid:border-red-500"]);
    });

    it("should extract named group/peer variants", () => {
      const content = `className="group-hover/sidebar:bg-gray-100 peer-checked/toggle:bg-blue-500"`;
      assertExtractsClasses(content, [
        "group-hover/sidebar:bg-gray-100",
        "peer-checked/toggle:bg-blue-500",
      ]);
    });
  });

  describe("Arbitrary Values", () => {
    it("should extract arbitrary width/height values", () => {
      const content = `className="w-[100px] h-[50vh] max-w-[80%]"`;
      assertExtractsClasses(content, ["w-[100px]", "h-[50vh]", "max-w-[80%]"]);
    });

    it("should extract arbitrary color values", () => {
      const content = `className="bg-[#ff0000] text-[#1a1a1a] border-[rgb(255,0,0)]"`;
      assertExtractsClasses(content, [
        "bg-[#ff0000]",
        "text-[#1a1a1a]",
        "border-[rgb(255,0,0)]",
      ]);
    });

    it("should extract arbitrary spacing values", () => {
      const content = `className="mt-[10px] p-[1.5rem] gap-[clamp(1rem,5vw,3rem)]"`;
      assertExtractsClasses(content, [
        "mt-[10px]",
        "p-[1.5rem]",
        "gap-[clamp(1rem,5vw,3rem)]",
      ]);
    });

    it("should extract calc() in arbitrary values", () => {
      const content = `className="w-[calc(100%-2rem)] h-[calc(100vh-64px)]"`;
      assertExtractsClasses(content, ["w-[calc(100%-2rem)]", "h-[calc(100vh-64px)]"]);
    });

    it("should extract url() in arbitrary values", () => {
      const content = `className="bg-[url('/img/hero.jpg')]"`;
      assertExtractsClasses(content, ["bg-[url('/img/hero.jpg')]"]);
    });

    it("should extract arbitrary font-family", () => {
      const content = `className="font-['Inter_var']"`;
      assertExtractsClasses(content, ["font-['Inter_var']"]);
    });

    it("should extract arbitrary grid template", () => {
      const content = `className="grid-cols-[1fr_2fr_1fr] grid-rows-[auto_1fr_auto]"`;
      assertExtractsClasses(content, ["grid-cols-[1fr_2fr_1fr]", "grid-rows-[auto_1fr_auto]"]);
    });

    it("should extract arbitrary content", () => {
      const content = `className="before:content-['*'] after:content-['x']"`;
      assertExtractsClasses(content, ["before:content-['*']", "after:content-['x']"]);
    });
  });

  describe("Arbitrary Properties", () => {
    it("should extract arbitrary CSS properties", () => {
      const content = `className="[mask-type:alpha] [clip-path:polygon(0_0,100%_0,100%_100%)]"`;
      assertExtractsClasses(content, [
        "[mask-type:alpha]",
        "[clip-path:polygon(0_0,100%_0,100%_100%)]",
      ]);
    });

    it("should extract arbitrary CSS variables", () => {
      const content = `className="[--my-color:theme(colors.blue.500)] [--gap:1rem]"`;
      assertExtractsClasses(content, [
        "[--my-color:theme(colors.blue.500)]",
        "[--gap:1rem]",
      ]);
    });

    it("should extract arbitrary properties with variants", () => {
      const content = `className="hover:[mask-type:luminance] dark:[--bg:black]"`;
      assertExtractsClasses(content, ["hover:[mask-type:luminance]", "dark:[--bg:black]"]);
    });
  });

  describe("Arbitrary Variants", () => {
    it("should extract arbitrary child selectors", () => {
      const content = `className="[&>*]:mt-4 [&>:first-child]:mt-0"`;
      assertExtractsClasses(content, ["[&>*]:mt-4", "[&>:first-child]:mt-0"]);
    });

    it("should extract arbitrary attribute selectors", () => {
      const content = `className="[&[data-state=open]]:bg-blue-500"`;
      assertExtractsClasses(content, ["[&[data-state=open]]:bg-blue-500"]);
    });

    it("should extract arbitrary hover selectors", () => {
      const content = `className="[&:hover]:bg-blue-600 [&:not(:first-child)]:border-t"`;
      assertExtractsClasses(content, [
        "[&:hover]:bg-blue-600",
        "[&:not(:first-child)]:border-t",
      ]);
    });

    it("should extract arbitrary sibling selectors", () => {
      const content = `className="[&+div]:mt-4 [&~*]:opacity-50"`;
      assertExtractsClasses(content, ["[&+div]:mt-4", "[&~*]:opacity-50"]);
    });
  });

  describe("Container Queries (Tailwind v4)", () => {
    it("should extract @container class", () => {
      const content = `className="@container @container/sidebar"`;
      assertExtractsClasses(content, ["@container", "@container/sidebar"]);
    });

    it("should extract container query breakpoints", () => {
      const content = `className="@sm:flex @md:grid @lg:hidden @xl:block"`;
      assertExtractsClasses(content, ["@sm:flex", "@md:grid", "@lg:hidden", "@xl:block"]);
    });

    it("should extract arbitrary container queries", () => {
      const content = `className="@[200px]:grid @[500px]:flex"`;
      assertExtractsClasses(content, ["@[200px]:grid", "@[500px]:flex"]);
    });

    it("should extract named container queries", () => {
      const content = `className="@sm/sidebar:hidden @lg/main:flex"`;
      assertExtractsClasses(content, ["@sm/sidebar:hidden", "@lg/main:flex"]);
    });
  });

  describe("Opacity Modifier", () => {
    it("should extract opacity modifiers on colors", () => {
      const content = `className="bg-black/50 text-white/75 border-gray-500/25"`;
      assertExtractsClasses(content, ["bg-black/50", "text-white/75", "border-gray-500/25"]);
    });

    it("should extract opacity modifiers with arbitrary colors", () => {
      const content = `className="bg-[#ff0000]/50 text-[rgb(0,0,0)]/75"`;
      assertExtractsClasses(content, ["bg-[#ff0000]/50", "text-[rgb(0,0,0)]/75"]);
    });

    it("should extract opacity modifiers with variants", () => {
      const content = `className="hover:bg-blue-500/80 dark:text-white/90"`;
      assertExtractsClasses(content, ["hover:bg-blue-500/80", "dark:text-white/90"]);
    });
  });

  describe("Fractions", () => {
    it("should extract fractional width utilities", () => {
      const content = `className="w-1/2 w-1/3 w-2/3 w-1/4 w-3/4"`;
      assertExtractsClasses(content, ["w-1/2", "w-1/3", "w-2/3", "w-1/4", "w-3/4"]);
    });

    it("should extract fractional translate values", () => {
      const content = `className="translate-x-1/2 -translate-y-1/4"`;
      assertExtractsClasses(content, ["translate-x-1/2", "-translate-y-1/4"]);
    });

    it("should extract fractional basis", () => {
      const content = `className="basis-1/2 basis-1/3 basis-2/5"`;
      assertExtractsClasses(content, ["basis-1/2", "basis-1/3", "basis-2/5"]);
    });

    it("should extract fractional inset", () => {
      const content = `className="top-1/2 left-1/4 inset-x-1/3"`;
      assertExtractsClasses(content, ["top-1/2", "left-1/4", "inset-x-1/3"]);
    });
  });

  describe("CSS Variable Utilities (Tailwind v4)", () => {
    it("should extract CSS variable references in utilities", () => {
      const content = `className="text-[--my-color] bg-[--theme-bg]"`;
      assertExtractsClasses(content, ["text-[--my-color]", "bg-[--theme-bg]"]);
    });

    it("should extract var() syntax in utilities", () => {
      const content = `className="text-[var(--my-color)] bg-[var(--theme-bg,#fff)]"`;
      assertExtractsClasses(content, [
        "text-[var(--my-color)]",
        "bg-[var(--theme-bg,#fff)]",
      ]);
    });
  });

  describe("Data Attribute Variants", () => {
    it("should extract data attribute variants", () => {
      const content = `className="data-[state=open]:flex data-[side=top]:mb-2"`;
      assertExtractsClasses(content, ["data-[state=open]:flex", "data-[side=top]:mb-2"]);
    });

    it("should extract data attribute with arbitrary values", () => {
      const content = `className="data-[loading=true]:animate-pulse"`;
      assertExtractsClasses(content, ["data-[loading=true]:animate-pulse"]);
    });
  });

  describe("Has Variants", () => {
    it("should extract has variants", () => {
      const content = `className="has-[>img]:block has-[input:focus]:ring-2"`;
      assertExtractsClasses(content, ["has-[>img]:block", "has-[input:focus]:ring-2"]);
    });

    it("should extract group-has variants", () => {
      const content = `className="group-has-[a]:underline"`;
      assertExtractsClasses(content, ["group-has-[a]:underline"]);
    });
  });

  describe("Supports Variants", () => {
    it("should extract supports variants", () => {
      const content = `className="supports-[display:grid]:grid"`;
      assertExtractsClasses(content, ["supports-[display:grid]:grid"]);
    });

    it("should extract supports with feature detection", () => {
      const content = `className="supports-[backdrop-filter]:backdrop-blur-sm"`;
      assertExtractsClasses(content, ["supports-[backdrop-filter]:backdrop-blur-sm"]);
    });
  });

  describe("Pseudo-elements", () => {
    it("should extract before/after pseudo-elements", () => {
      const content =
        `className="before:content-[''] after:content-[''] before:absolute after:block"`;
      assertExtractsClasses(content, [
        "before:content-['']",
        "after:content-['']",
        "before:absolute",
        "after:block",
      ]);
    });

    it("should extract first-line/first-letter pseudo-elements", () => {
      const content = `className="first-line:uppercase first-letter:text-4xl"`;
      assertExtractsClasses(content, ["first-line:uppercase", "first-letter:text-4xl"]);
    });

    it("should extract marker pseudo-element", () => {
      const content = `className="marker:text-blue-500"`;
      assertExtractsClasses(content, ["marker:text-blue-500"]);
    });

    it("should extract selection pseudo-element", () => {
      const content = `className="selection:bg-blue-200 selection:text-blue-900"`;
      assertExtractsClasses(content, ["selection:bg-blue-200", "selection:text-blue-900"]);
    });

    it("should extract placeholder pseudo-element", () => {
      const content = `className="placeholder:text-gray-400 placeholder:italic"`;
      assertExtractsClasses(content, ["placeholder:text-gray-400", "placeholder:italic"]);
    });

    it("should extract file pseudo-element", () => {
      const content = `className="file:mr-4 file:py-2 file:px-4 file:rounded-full"`;
      assertExtractsClasses(content, [
        "file:mr-4",
        "file:py-2",
        "file:px-4",
        "file:rounded-full",
      ]);
    });

    it("should extract backdrop pseudo-element", () => {
      const content = `className="backdrop:bg-black/50"`;
      assertExtractsClasses(content, ["backdrop:bg-black/50"]);
    });
  });

  describe("Transforms (including Tailwind v4 3D)", () => {
    it("should extract 2D transform utilities", () => {
      const content = `className="rotate-45 scale-110 skew-x-12 translate-x-4"`;
      assertExtractsClasses(content, ["rotate-45", "scale-110", "skew-x-12", "translate-x-4"]);
    });

    it("should extract 3D transform utilities", () => {
      const content = `className="rotate-x-45 rotate-y-90 rotate-z-180"`;
      assertExtractsClasses(content, ["rotate-x-45", "rotate-y-90", "rotate-z-180"]);
    });

    it("should extract perspective utilities", () => {
      const content = `className="perspective-500 perspective-none perspective-[1000px]"`;
      assertExtractsClasses(content, [
        "perspective-500",
        "perspective-none",
        "perspective-[1000px]",
      ]);
    });

    it("should extract transform-style and backface-visibility", () => {
      const content = `className="transform-3d backface-hidden preserve-3d"`;
      assertExtractsClasses(content, ["transform-3d", "backface-hidden", "preserve-3d"]);
    });
  });

  describe("Aspect Ratio", () => {
    it("should extract aspect ratio utilities", () => {
      const content = `className="aspect-square aspect-video aspect-auto"`;
      assertExtractsClasses(content, ["aspect-square", "aspect-video", "aspect-auto"]);
    });

    it("should extract arbitrary aspect ratios", () => {
      const content = `className="aspect-[4/3] aspect-[16/9] aspect-[21/9]"`;
      assertExtractsClasses(content, ["aspect-[4/3]", "aspect-[16/9]", "aspect-[21/9]"]);
    });
  });

  describe("Print Variant", () => {
    it("should extract print variants", () => {
      const content = `className="print:hidden print:bg-white print:text-black"`;
      assertExtractsClasses(content, ["print:hidden", "print:bg-white", "print:text-black"]);
    });
  });

  describe("RTL/LTR Variants", () => {
    it("should extract rtl/ltr variants", () => {
      const content = `className="rtl:space-x-reverse ltr:ml-4 rtl:mr-4"`;
      assertExtractsClasses(content, ["rtl:space-x-reverse", "ltr:ml-4", "rtl:mr-4"]);
    });
  });

  describe("Motion Variants", () => {
    it("should extract motion-safe/motion-reduce variants", () => {
      const content = `className="motion-safe:animate-spin motion-reduce:animate-none"`;
      assertExtractsClasses(content, [
        "motion-safe:animate-spin",
        "motion-reduce:animate-none",
      ]);
    });
  });

  describe("Portrait/Landscape Variants", () => {
    it("should extract orientation variants", () => {
      const content = `className="portrait:hidden landscape:flex"`;
      assertExtractsClasses(content, ["portrait:hidden", "landscape:flex"]);
    });
  });

  describe("Contrast Variants", () => {
    it("should extract contrast variants", () => {
      const content = `className="contrast-more:border-2 contrast-less:opacity-75"`;
      assertExtractsClasses(content, ["contrast-more:border-2", "contrast-less:opacity-75"]);
    });
  });

  describe("Edge Cases", () => {
    it("should deduplicate classes", () => {
      const content = `className="mt-4 mt-4 bg-blue-500 bg-blue-500"`;
      const result = extractCandidates(content);

      assertEquals(result.filter((c) => c === "mt-4").length, 1, "Should deduplicate mt-4");
      assertEquals(
        result.filter((c) => c === "bg-blue-500").length,
        1,
        "Should deduplicate bg-blue-500",
      );
    });

    it("should handle empty content", () => {
      assertEquals(extractCandidates("").length, 0, "Should return empty array for empty content");
    });

    it("should handle content with no classes", () => {
      const content = "Hello world! This is some text.";
      const result = extractCandidates(content);

      // Note: words like "Hello", "world", "This", etc. will be extracted but that's fine.
      // The important thing is it doesn't crash.
      assertEquals(Array.isArray(result), true, "Should return an array");
    });

    it("should handle JSX className strings", () => {
      const content = `
        <div className="mt-4 bg-blue-500 p-2">
          <span className="text-lg font-bold">Hello</span>
        </div>
      `;
      assertExtractsClasses(content, [
        "mt-4",
        "bg-blue-500",
        "p-2",
        "text-lg",
        "font-bold",
      ]);
    });

    it("should handle classes in string arrays", () => {
      const content = `const classes = ["flex", "items-center", "justify-between"];`;
      assertExtractsClasses(content, ["flex", "items-center", "justify-between"]);
    });

    it("should handle clsx/cn function calls", () => {
      const content = `cn("base-class", isActive && "active-class", { "conditional": isTrue })`;
      assertExtractsClasses(content, ["base-class", "active-class", "conditional"]);
    });
  });

  describe("Real-world Component Examples", () => {
    it("should extract classes from a button component", () => {
      const content = `
        <button
          className="inline-flex items-center justify-center rounded-md text-sm font-medium
            ring-offset-background transition-colors focus-visible:outline-none
            focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
            disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground
            hover:bg-primary/90 h-10 px-4 py-2"
        >
      `;
      assertExtractsClasses(content, [
        "inline-flex",
        "items-center",
        "justify-center",
        "rounded-md",
        "text-sm",
        "font-medium",
        "ring-offset-background",
        "transition-colors",
        "focus-visible:outline-none",
        "focus-visible:ring-2",
        "disabled:pointer-events-none",
        "disabled:opacity-50",
        "hover:bg-primary/90",
        "h-10",
        "px-4",
        "py-2",
      ]);
    });

    it("should extract classes from a card component", () => {
      const content = `
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm
          hover:shadow-md transition-shadow dark:border-gray-800">
          <div className="flex flex-col space-y-1.5 p-6">
            <h3 className="text-2xl font-semibold leading-none tracking-tight">
      `;
      assertExtractsClasses(content, [
        "rounded-lg",
        "border",
        "bg-card",
        "text-card-foreground",
        "shadow-sm",
        "hover:shadow-md",
        "transition-shadow",
        "dark:border-gray-800",
        "flex",
        "flex-col",
        "space-y-1.5",
        "p-6",
        "text-2xl",
        "font-semibold",
        "leading-none",
        "tracking-tight",
      ]);
    });

    it("should extract classes from a modal overlay", () => {
      const content = `
        <div className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in
          data-[state=closed]:animate-out data-[state=closed]:fade-out-0
          data-[state=open]:fade-in-0">
      `;
      assertExtractsClasses(content, [
        "fixed",
        "inset-0",
        "z-50",
        "bg-black/80",
        "data-[state=open]:animate-in",
        "data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0",
        "data-[state=open]:fade-in-0",
      ]);
    });

    it("should extract classes with responsive and dark mode stacking", () => {
      const content = `
        className="w-full sm:w-1/2 md:w-1/3 lg:w-1/4
          dark:bg-gray-800 dark:hover:bg-gray-700
          sm:dark:text-gray-200"
      `;
      assertExtractsClasses(content, [
        "w-full",
        "sm:w-1/2",
        "md:w-1/3",
        "lg:w-1/4",
        "dark:bg-gray-800",
        "dark:hover:bg-gray-700",
        "sm:dark:text-gray-200",
      ]);
    });
  });
});
