/**
 * Helpers for the autodocs Code panel: formatting story args as JSX props,
 * synthesising whole JSX tags for args-only stories, and resolving `{...args}`
 * spreads inside source captured from `render: (args) => ...` bodies.
 *
 * Kept separate from the React component in `DocsExampleAuto.tsx` so the logic
 * can be unit-tested without rendering. Also referenced by tests in
 * `composeJsx.test.ts`.
 */

type ReactElementLike = {
  $$typeof: symbol
  type: unknown
  props: Record<string, unknown> & { children?: unknown }
}

function isReactElement(value: unknown): value is ReactElementLike {
  return typeof value === 'object' && value !== null && '$$typeof' in (value as Record<string, unknown>)
}

/**
 * Best-effort display name for a React element's `type`. Handles plain string
 * tags (`'div'`), function/class components (via `displayName`/`name`), and
 * the wrapper objects emitted by `forwardRef`, `memo`, and `lazy`. Fragments
 * return the empty string so the caller can render their children inline
 * without a tag wrapper. Anything we can't classify becomes `'…'`.
 */
function formatTypeName(type: unknown): string {
  if (typeof type === 'string') return type
  if (typeof type === 'function') {
    const fn = type as { displayName?: string; name?: string }
    return fn.displayName ?? fn.name ?? 'Component'
  }
  if (typeof type === 'symbol') {
    return type.description === 'react.fragment' ? '' : '…'
  }
  if (typeof type === 'object' && type !== null) {
    const wrapper = type as { displayName?: string; type?: unknown; render?: unknown }
    if (wrapper.displayName) return wrapper.displayName
    const inner = wrapper.type ?? wrapper.render
    return inner ? formatTypeName(inner) : '…'
  }
  return '…'
}

function formatChildren(children: unknown): string {
  if (children == null || children === false || children === true) return ''
  if (typeof children === 'string') return children
  if (typeof children === 'number' || typeof children === 'bigint') return String(children)
  if (Array.isArray(children)) return children.map(formatChildren).join('')
  if (isReactElement(children)) return formatReactElement(children)
  return ''
}

/**
 * Stringify a React element to JSX. Recursive — children that are themselves
 * elements are rendered inline, props that are elements use the same path
 * via `formatPropValue`. Fragments unwrap to their children with no tag.
 */
function formatReactElement(element: ReactElementLike): string {
  const { type, props } = element
  const typeName = formatTypeName(type)
  if (typeName === '') return formatChildren(props.children)

  const propEntries: string[] = []
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children') continue
    const formatted = formatPropValue(value)
    if (formatted === null) continue
    if (formatted === '') propEntries.push(key)
    else propEntries.push(`${key}=${formatted}`)
  }
  const propsStr = propEntries.length > 0 ? ` ${propEntries.join(' ')}` : ''

  if (props.children == null || props.children === false || props.children === true) {
    return `<${typeName}${propsStr} />`
  }
  const childrenStr = formatChildren(props.children)
  if (childrenStr === '') return `<${typeName}${propsStr} />`
  return `<${typeName}${propsStr}>${childrenStr}</${typeName}>`
}

/**
 * Format a single primitive/value as it would appear on the right-hand side
 * of a JSX attribute. Returns `null` for values we can't represent (omit the
 * prop entirely), `''` for `true` (bare prop name), and otherwise the JSX
 * fragment to use after `=`. React elements and arrays of representable items
 * are stringified recursively so slot props like `slot={<p>Hello</p>}` and
 * children-as-array props are visible in the Code panel.
 */
export function formatPropValue(value: unknown): string | null {
  if (value === undefined) return null
  if (value === true) return ''
  if (value === false) return '{false}'
  if (value === null) return '{null}'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'bigint') return `{${String(value)}}`
  if (isReactElement(value)) return `{${formatReactElement(value)}}`
  if (Array.isArray(value)) return formatArrayValue(value)
  if (typeof value === 'object') return '{{…}}'
  if (typeof value === 'function') return '{() => …}'
  return null
}

/**
 * Render an array as `{[item1, item2, …]}` when every item is representable
 * (primitive or React element). If any item is a complex object/function the
 * whole array collapses to `{[…]}` — partial item lists are misleading.
 */
function formatArrayValue(value: unknown[]): string {
  if (value.length === 0) return '{[]}'
  const items: string[] = []
  for (const item of value) {
    const rendered = formatArrayItem(item)
    if (rendered === null) return '{[…]}'
    items.push(rendered)
  }
  return `{[${items.join(', ')}]}`
}

function formatArrayItem(item: unknown): string | null {
  if (item === null) return 'null'
  if (item === undefined) return 'undefined'
  if (typeof item === 'string') return JSON.stringify(item)
  if (typeof item === 'number' || typeof item === 'bigint' || typeof item === 'boolean') return String(item)
  if (isReactElement(item)) return formatReactElement(item)
  return null
}

export function formatArgsProps(args: Record<string, unknown>): string {
  const formatted: string[] = []
  for (const [key, value] of Object.entries(args)) {
    const formattedValue = formatPropValue(value)
    if (formattedValue === null) continue
    if (formattedValue === '') formatted.push(key)
    else formatted.push(`${key}=${formattedValue}`)
  }
  return formatted.join(' ')
}

export function composeJsx(componentName: string, args: Record<string, unknown>): string {
  const props = formatArgsProps(args)
  if (props.length === 0) return `<${componentName} />`
  const inline = `<${componentName} ${props} />`
  if (inline.length <= 100) return inline
  return `<${componentName}\n  ${props.split(' ').join('\n  ')}\n/>`
}

/**
 * Replace `{...args}` spreads in source extracted from a `render: (args) => ...`
 * body with the resolved prop list, so the autodocs Code panel shows what was
 * actually passed at runtime instead of the literal spread token. Leading
 * whitespace before the spread is consumed and re-emitted with the props,
 * so empty args don't leave a trailing double space inside the tag.
 *
 * Only `{...args}` (with optional inner whitespace) is rewritten — destructured
 * spreads like `{...rest}` or `{...someOtherIdent}` are left alone, since the
 * caller doesn't have those values.
 */
export function resolveArgsSpread(source: string, args: Record<string, unknown>): string {
  if (!source.includes('...args')) return source
  const props = formatArgsProps(args)
  return source.replace(/\s*\{\s*\.\.\.args\s*\}/g, props ? ` ${props}` : '')
}
