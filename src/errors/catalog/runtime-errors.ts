import type { PartialErrorCatalog } from "./types.ts";
import { createErrorSolution, createSimpleError } from "./factory.ts";

export const RUNTIME_ERROR_CATALOG: PartialErrorCatalog = {
  "hydration-mismatch": createErrorSolution("hydration-mismatch", {
    title: "Hydration mismatch",
    message: "Client-side HTML does not match server-rendered HTML.",
    steps: [
      "Check for random values or timestamps in render",
      "Ensure Date() calls are consistent",
      "Avoid using browser-only APIs during SSR",
      "Check for white space or formatting differences",
    ],
    example: `// ❌ Wrong - random on each render
<div>{Math.random()}</div>

const [random, setRandom] = useState(0)
useEffect(() => setRandom(Math.random()), [])
<div>{random}</div>`,
    relatedErrors: ["render-error"],
  }),

  "render-error": createSimpleError(
    "render-error",
    "Render error",
    "Failed to render component.",
    [
      "Check the component for errors",
      "Ensure all props are valid",
      "Look for null/undefined access",
      "Check error boundaries",
    ],
  ),

  "component-error": createSimpleError(
    "component-error",
    "Component error",
    "Error in component lifecycle or render.",
    [
      "Check component code for errors",
      "Ensure hooks follow Rules of Hooks",
      "Verify props are passed correctly",
    ],
  ),

  "layout-not-found": createErrorSolution("layout-not-found", {
    title: "Layout file not found",
    message: "Required layout file is missing.",
    steps: [
      "Create app/layout.tsx in App Router",
      "Or create layouts/default.mdx for Pages Router",
      "Check file path and name are correct",
    ],
    example: `// app/layout.tsx
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}`,
  }),

  "page-not-found": createSimpleError(
    "page-not-found",
    "Page not found",
    "The requested page does not exist.",
    [
      "Check that the page file exists",
      "Verify file name matches route",
      "Ensure file extension is correct (.tsx, .jsx, .mdx)",
    ],
  ),

  "api-error": createSimpleError(
    "api-error",
    "API handler error",
    "Error in API route handler.",
    [
      "Check API handler code for errors",
      "Ensure proper error handling",
      "Verify request/response format",
    ],
  ),

  "middleware-error": createSimpleError(
    "middleware-error",
    "Middleware error",
    "Error in middleware execution.",
    [
      "Check middleware code for errors",
      "Ensure middleware returns Response",
      "Verify middleware is properly exported",
    ],
  ),
};
