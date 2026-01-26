/**
 * Base styles for markdown/MDX content.
 * Applied to .vf-prose elements. Opt out with `prose: false` in frontmatter.
 * Prepended to user stylesheet, so users can override.
 */
export const MDX_BASE_STYLES = `
.vf-prose {
  p { @apply mb-4; }
  h1 { @apply text-4xl font-bold mb-8 mt-12; }
  h2 { @apply text-3xl font-bold mb-6 mt-10; }
  h3 { @apply text-2xl font-bold mb-4 mt-8; }
  a { @apply text-blue-600 hover:text-blue-800 underline; }
  pre code[class*="language-"], pre code.hljs { @apply block p-4 bg-gray-900 text-gray-100 rounded-lg overflow-x-auto; }
  :not(pre) > code { @apply px-1 py-0.5 bg-gray-100 text-gray-900 rounded text-sm; }
  blockquote { @apply border-l-4 border-gray-300 pl-4 italic; }
  ul { @apply list-disc list-inside mb-4; }
  ol { @apply list-decimal list-inside mb-4; }
  li { @apply mb-2; }
}
`;
