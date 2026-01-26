import { ErrorCode } from "../error-codes.js";
import type { PartialErrorCatalog } from "./types.js";
import { createErrorSolution, createSimpleError } from "./factory.js";

export const RUNTIME_ERROR_CATALOG: PartialErrorCatalog = {
  [ErrorCode.HYDRATION_MISMATCH]: createErrorSolution(ErrorCode.HYDRATION_MISMATCH, {
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
    relatedErrors: [ErrorCode.RENDER_ERROR],
  }),

  [ErrorCode.RENDER_ERROR]: createSimpleError(
    ErrorCode.RENDER_ERROR,
    "Render error",
    "Failed to render component.",
    [
      "Check the component for errors",
      "Ensure all props are valid",
      "Look for null/undefined access",
      "Check error boundaries",
    ],
  ),

  [ErrorCode.COMPONENT_ERROR]: createSimpleError(
    ErrorCode.COMPONENT_ERROR,
    "Component error",
    "Error in component lifecycle or render.",
    [
      "Check component code for errors",
      "Ensure hooks follow Rules of Hooks",
      "Verify props are passed correctly",
    ],
  ),

  [ErrorCode.LAYOUT_NOT_FOUND]: createErrorSolution(ErrorCode.LAYOUT_NOT_FOUND, {
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

  [ErrorCode.PAGE_NOT_FOUND]: createSimpleError(
    ErrorCode.PAGE_NOT_FOUND,
    "Page not found",
    "The requested page does not exist.",
    [
      "Check that the page file exists",
      "Verify file name matches route",
      "Ensure file extension is correct (.tsx, .jsx, .mdx)",
    ],
  ),

  [ErrorCode.API_ERROR]: createSimpleError(
    ErrorCode.API_ERROR,
    "API handler error",
    "Error in API route handler.",
    [
      "Check API handler code for errors",
      "Ensure proper error handling",
      "Verify request/response format",
    ],
  ),

  [ErrorCode.MIDDLEWARE_ERROR]: createSimpleError(
    ErrorCode.MIDDLEWARE_ERROR,
    "Middleware error",
    "Error in middleware execution.",
    [
      "Check middleware code for errors",
      "Ensure middleware returns Response",
      "Verify middleware is properly exported",
    ],
  ),
};
