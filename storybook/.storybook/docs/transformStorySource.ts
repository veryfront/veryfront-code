/**
 * Storybook source transform for CSF stories that use a `render` callback.
 *
 * Strips the `{ render: () => (...) }` wrapper Storybook emits via static source
 * extraction, returning just the inner JSX dedented to column 0. Wired globally
 * in `.storybook/preview.tsx` so every component's autodocs Code panel shows
 * teaching-quality snippets without per-story configuration.
 *
 * - Expression-bodied render: `render: () => <JSX />` → outputs `<JSX />`.
 * - Block-bodied render with hooks: `render: () => { const [x] = useState(); return <JSX /> }`
 *   → outputs `function Example() { const [x] = useState(); return <JSX /> }`.
 *
 * Storybook's source extractor normalises single-identifier params to `args` (no
 * parens), so the parser accepts both `(args) => ...` and `args => ...`.
 *
 * The body is extracted via brace/paren/bracket counting with string-literal
 * awareness, so `render` is not required to be the final property of the story
 * object and bodies containing `}` inside object literals or string literals
 * are handled correctly. JSX angle brackets are not counted toward depth — they
 * don't pair like braces, but the JSX expression children that contain `{ }`
 * do balance, which is what matters for property delimiting.
 *
 * Per-story overrides via `parameters.docs.source.code` bypass this transform —
 * use that when the wrapper has shared state reused across multiple variants.
 */
/**
 * Veryfront wrapper: strip the `render` wrapper (Studio behaviour) and then
 * unwrap the `StoryFrame` / `ReviewSurface` review-harness components so the
 * Code panel shows the relevant component usage rather than the Storybook
 * scaffolding. Wired globally as `parameters.docs.source.transform`.
 */
export function transformVeryfrontStorySource(code: string): string {
  return stripReviewHarness(transformStorySource(code))
}

// The review-harness wrapper components, removed from displayed snippets so the
// Code panel shows the relevant component usage. Their props (maxWidth, label,
// className) never contain `>`, so simple tag matching is safe.
const HARNESS_TAG_RE =
  /<\/?(?:StoryFrame|ReviewSurface)\b[^>]*>/g

// Wrapper `<div className="...">` elements that are pure story scaffolding —
// removed (opening + depth-matched closing tag) so the Code panel shows the
// component usage, not the review-canvas chrome.
const HARNESS_DIV_CLASSES = ['vf-story-canvas']

function stripReviewHarness(code: string): string {
  let stripped = code
  for (const cls of HARNESS_DIV_CLASSES) {
    stripped = stripWrapperDivByClass(stripped, cls)
  }
  const withoutTags = stripped
    .replace(HARNESS_TAG_RE, '')
    // After removing an opening tag that followed `return`, pull the first
    // child back onto the `return` line so ASI doesn't turn it into `return;`.
    .replace(/return\s*\n\s*/g, 'return ')
  const lines = withoutTags
    .split('\n')
    .filter((line) => line.trim().length > 0 && line.trim() !== ';')
  return dedentAll(lines.join('\n')).replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Remove `<div className="<cls>"> … </div>` wrapper elements — the opening tag
 * and its depth-matched closing `</div>` — keeping the inner content. Counts
 * nested `<div>`/`</div>` so the correct closing tag is removed.
 */
function stripWrapperDivByClass(code: string, cls: string): string {
  const openRe = new RegExp(`<div\\s+className="${cls}"[^>]*>`)
  let result = code
  let guard = 0
  while (guard++ < 50) {
    const m = openRe.exec(result)
    if (!m) break
    const openStart = m.index
    const openEnd = m.index + m[0].length
    const tagRe = /<div\b[^>]*>|<\/div>/g
    tagRe.lastIndex = openEnd
    let depth = 1
    let closeStart = -1
    let closeEnd = -1
    let t: RegExpExecArray | null
    while ((t = tagRe.exec(result)) !== null) {
      if (t[0] === '</div>') {
        depth--
        if (depth === 0) {
          closeStart = t.index
          closeEnd = t.index + t[0].length
          break
        }
      } else {
        depth++
      }
    }
    if (closeStart === -1) break // unbalanced — leave as-is
    result = result.slice(0, openStart) +
      result.slice(openEnd, closeStart) +
      result.slice(closeEnd)
  }
  return result
}

/** Dedent by the smallest indent across ALL non-empty lines (unlike `dedent`,
 *  which ignores the first line — needed after wrapper lines are removed). */
function dedentAll(input: string): string {
  const lines = input.split('\n')
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^ */)?.[0].length ?? 0)
  if (indents.length === 0) return input
  const min = Math.min(...indents)
  if (min === 0) return input
  return lines.map((line) => line.slice(min)).join('\n')
}

export function transformStorySource(code: string): string {
  const extracted = extractRenderBody(code)
  if (!extracted) return code

  let inner = extracted.trim()

  // Block-bodied arrow: `render: () => { const x = ...; return (<JSX />) }`
  if (inner.startsWith('{') && inner.endsWith('}')) {
    const body = inner.slice(1, -1)
    const dedentedBody = dedent(body).trim()
    return `function Example() {\n  ${dedentedBody.split('\n').join('\n  ')}\n}`
  }

  // Expression body wrapped in parens: strip them.
  if (inner.startsWith('(') && inner.endsWith(')')) {
    inner = inner.slice(1, -1).trim()
  }
  return dedent(inner)
}

/**
 * Locate `render: <arrowFn>` inside a story object literal source string and
 * return the arrow function body verbatim (untrimmed). Returns `null` when no
 * render property is present or the shape is unrecognised.
 */
function extractRenderBody(code: string): string | null {
  const renderIdx = findRenderKey(code)
  if (renderIdx === -1) return null

  // Skip past `render` and the `:`.
  let i = renderIdx + 'render'.length
  i = skipWhitespace(code, i)
  if (code[i] !== ':') return null
  i++
  i = skipWhitespace(code, i)

  // Parse arrow function head: `(...)` or bare identifier.
  if (code[i] === '(') {
    i = skipBalanced(code, i, '(', ')')
    if (i === -1) return null
  } else if (isIdentStart(code[i])) {
    while (i < code.length && isIdentPart(code[i])) i++
  } else {
    return null
  }

  i = skipWhitespace(code, i)
  if (code.slice(i, i + 2) !== '=>') return null
  i += 2
  i = skipWhitespace(code, i)

  // Capture body until top-level `,` or `}` of containing object.
  return captureUntilDelimiter(code, i)
}

/**
 * Find the index of a top-level `render` property key in the source. "Top-level"
 * means at brace-depth 1 (inside the outer `{ ... }` of the story export). We
 * scan with string-aware depth tracking so `render` substrings inside JSX text,
 * string literals, or nested object values don't trigger false matches.
 */
function findRenderKey(code: string): number {
  let depth = 0
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    const stringEnd = consumeString(code, i)
    if (stringEnd !== -1) {
      i = stringEnd
      continue
    }
    if (ch === '{' || ch === '(' || ch === '[') {
      depth++
      i++
      continue
    }
    if (ch === '}' || ch === ')' || ch === ']') {
      depth--
      i++
      continue
    }
    // Match `render` only at depth 1 (inside the outer object) and only as a
    // standalone identifier (not as part of a longer word like `myrender`).
    if (depth === 1 && code.startsWith('render', i)) {
      const before = i === 0 ? '' : code[i - 1]
      const after = code[i + 'render'.length] ?? ''
      if (!isIdentPart(before) && !isIdentPart(after)) {
        return i
      }
    }
    i++
  }
  return -1
}

/**
 * Capture text starting at `start` up to the first top-level `,` or `}`,
 * tracking nested brackets, string literals, and JSX element nesting so
 * delimiters inside the body don't terminate the capture early.
 *
 * Storybook's source loader sometimes strips the wrapping parens from a
 * single-JSX-expression render body, so `<Foo>...</Foo>` arrives without a
 * `(` to lift bracket depth above zero. JSX text routinely contains commas
 * (e.g. "Build, deploy and host your React app"), and without JSX awareness
 * those commas would terminate the body early and the Code panel would
 * render a truncated snippet.
 */
function captureUntilDelimiter(code: string, start: number): string {
  let depth = 0
  let jsxDepth = 0
  let i = start
  while (i < code.length) {
    const ch = code[i]
    const stringEnd = consumeString(code, i)
    if (stringEnd !== -1) {
      i = stringEnd
      continue
    }
    if (ch === '{' || ch === '(' || ch === '[') {
      depth++
      i++
      continue
    }
    if (ch === '}' || ch === ')' || ch === ']') {
      if (depth === 0 && jsxDepth === 0) {
        // `}` at depth 0 closes the containing story object — stop before it.
        break
      }
      if (depth > 0) depth--
      i++
      continue
    }
    // JSX tags at expression-level (not inside a `{...}` interpolation): track
    // element nesting so JSX text content doesn't get parsed as JS.
    if (ch === '<' && depth === 0) {
      const tag = parseJsxTag(code, i)
      if (tag) {
        if (tag.kind === 'open') jsxDepth++
        else if (tag.kind === 'close') jsxDepth--
        i = tag.end
        continue
      }
    }
    if (ch === ',' && depth === 0 && jsxDepth === 0) break
    i++
  }
  return code.slice(start, i)
}

type JsxTag = { kind: 'open' | 'close' | 'selfClose'; end: number }

/**
 * If `code[start]` opens a JSX tag (`<X...>`, `</X>`, or `<X.../>`), scan to
 * the matching `>` and return the tag kind plus the index just past it.
 * Returns `null` when the `<` is not followed by an identifier (e.g. it's a
 * `<` operator inside an unbalanced expression). String literals and `{...}`
 * expressions inside attribute values are skipped so a `>` inside a prop
 * doesn't close the tag prematurely.
 */
function parseJsxTag(code: string, start: number): JsxTag | null {
  let i = start + 1
  let kind: JsxTag['kind'] = 'open'
  if (code[i] === '/') {
    kind = 'close'
    i++
  }
  if (!isIdentStart(code[i])) return null
  let braceDepth = 0
  while (i < code.length) {
    const stringEnd = consumeString(code, i)
    if (stringEnd !== -1) {
      i = stringEnd
      continue
    }
    const ch = code[i]
    if (ch === '{') {
      braceDepth++
      i++
      continue
    }
    if (ch === '}') {
      if (braceDepth > 0) braceDepth--
      i++
      continue
    }
    if (braceDepth === 0 && ch === '/' && code[i + 1] === '>') {
      return { kind: 'selfClose', end: i + 2 }
    }
    if (braceDepth === 0 && ch === '>') {
      return { kind, end: i + 1 }
    }
    i++
  }
  return null
}

/**
 * If `code[start]` opens a string or template literal, consume it (handling
 * escape sequences and template `${...}` interpolations) and return the index
 * just past the closing quote. Returns -1 when no string is at this position.
 *
 * For `'` and `"` we additionally check that the preceding non-whitespace
 * character is not an identifier char — otherwise an apostrophe inside JSX
 * text (`we're`, `O'Brien`) would falsely open a string literal and the parser
 * would scan to the next `'` (or end of input), swallowing the rest of the
 * body. Backticks bypass this check so tagged templates like `css\`...\``
 * still work; tagged-template-shaped content is not expected inside JSX text.
 */
function consumeString(code: string, start: number): number {
  const ch = code[start]
  if (ch !== "'" && ch !== '"' && ch !== '`') return -1
  if (ch === "'" || ch === '"') {
    let p = start - 1
    while (p >= 0 && /\s/.test(code[p])) p--
    if (p >= 0 && isIdentPart(code[p])) return -1
  }
  let i = start + 1
  while (i < code.length) {
    const c = code[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === ch) return i + 1
    if (ch === '`' && c === '$' && code[i + 1] === '{') {
      // Skip the `${ ... }` interpolation, which can contain arbitrary code
      // including nested template literals.
      const end = skipBalanced(code, i + 1, '{', '}')
      if (end === -1) return code.length
      i = end
      continue
    }
    i++
  }
  return code.length
}

/**
 * Skip a balanced `(...)`, `{...}`, or `[...]` starting at `start` (which must
 * be the opening bracket). Returns the index just past the matching close, or
 * -1 if unbalanced. String-aware so quoted brackets don't throw off the count.
 */
function skipBalanced(code: string, start: number, open: string, close: string): number {
  if (code[start] !== open) return -1
  let depth = 1
  let i = start + 1
  while (i < code.length && depth > 0) {
    const stringEnd = consumeString(code, i)
    if (stringEnd !== -1) {
      i = stringEnd
      continue
    }
    if (code[i] === open) depth++
    else if (code[i] === close) depth--
    i++
  }
  return depth === 0 ? i : -1
}

function skipWhitespace(code: string, i: number): number {
  while (i < code.length && /\s/.test(code[i])) i++
  return i
}

function isIdentStart(ch: string): boolean {
  return /[a-zA-Z_$]/.test(ch)
}

function isIdentPart(ch: string): boolean {
  return /[\w$]/.test(ch)
}

function dedent(input: string): string {
  const lines = input.split('\n')
  const indents = lines
    .slice(1)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^ */)?.[0].length ?? 0)
  if (indents.length === 0) return input
  const minIndent = Math.min(...indents)
  if (minIndent === 0) return input
  return lines.map((line, i) => (i === 0 ? line : line.slice(minIndent))).join('\n')
}
