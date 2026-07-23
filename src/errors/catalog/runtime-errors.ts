import type { PartialErrorCatalog } from "./types.ts";
import { createErrorSolution, createSimpleError } from "./factory.ts";

/** Immutable error-solution catalog fragment. */
export const RUNTIME_ERROR_CATALOG: PartialErrorCatalog = Object.freeze({
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

  "trigger-target-not-found": createSimpleError(
    "trigger-target-not-found",
    "Trigger target not found",
    "The trigger references a task or workflow that is not registered.",
    [
      "Check the target ID for spelling errors",
      "Export the referenced task or workflow from the project",
      "Restart the runtime after changing project exports",
    ],
  ),

  "trigger-execution-failed": createSimpleError(
    "trigger-execution-failed",
    "Trigger execution failed",
    "The trigger target failed during execution.",
    [
      "Review the task or workflow failure",
      "Verify that the trigger input matches the target schema",
      "Run the target directly to isolate the failure",
    ],
  ),

  "trigger-not-supported": createSimpleError(
    "trigger-not-supported",
    "Trigger target is not supported",
    "The selected target type is not supported by the local runtime.",
    [
      "Use a workflow or task target for local trigger execution",
      "Select a runtime that supports the required target type",
      "Run 'veryfront schema --json' to inspect supported trigger targets",
    ],
  ),

  "missing-extension": createSimpleError(
    "missing-extension",
    "Required extension not found",
    "Veryfront could not load an extension required by the current configuration.",
    [
      "Check that the extension package is installed",
      "Add the extension to the project configuration",
      "Restart Veryfront and verify extension discovery",
    ],
  ),

  "extension-setup-timeout": createSimpleError(
    "extension-setup-timeout",
    "Extension setup timed out",
    "An extension did not finish setup within the configured lifecycle timeout.",
    [
      "Remove blocking or unbounded work from the extension setup function",
      "Ensure setup observes the provided cancellation signal",
      "Increase the setup timeout only when the expected work requires it",
    ],
  ),
});
