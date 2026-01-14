import React, { createContext, useContext, useEffect, useState } from "react"
import {
  createHighlighterCore,
  createJavaScriptRegexEngine,
  type HighlighterCore,
} from "https://esm.sh/shiki"

interface HighlighterContextValue {
  highlighter: HighlighterCore | null
  highlighterLoading: boolean
}

const HighlighterContext = createContext<HighlighterContextValue | null>(null)

export function HighlighterProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [highlighter, setHighlighter] = useState<HighlighterCore | null>(null)
  const [highlighterLoading, setHighlighterLoading] = useState(true)

  useEffect(() => {
    async function initHighlighter() {
      try {
        const newHighlighter = await createHighlighterCore({
          themes: [
            import("https://esm.sh/shiki/themes/github-light.mjs"),
            import("https://esm.sh/shiki/themes/github-dark.mjs"),
          ],
          langs: [
            import("https://esm.sh/shiki/langs/javascript.mjs"),
            import("https://esm.sh/shiki/langs/typescript.mjs"),
            import("https://esm.sh/shiki/langs/tsx.mjs"),
            import("https://esm.sh/shiki/langs/jsx.mjs"),
            import("https://esm.sh/shiki/langs/mdx.mjs"),
            import("https://esm.sh/shiki/langs/json.mjs"),
            import("https://esm.sh/shiki/langs/css.mjs"),
            import("https://esm.sh/shiki/langs/html.mjs"),
            import("https://esm.sh/shiki/langs/yaml.mjs"),
            import("https://esm.sh/shiki/langs/markdown.mjs"),
            import("https://esm.sh/shiki/langs/md.mjs"),
            import("https://esm.sh/shiki/langs/scss.mjs"),
            import("https://esm.sh/shiki/langs/bash.mjs"),
            import("https://esm.sh/shiki/langs/shell.mjs"),
            import("https://esm.sh/shiki/langs/dotenv.mjs"),
            import("https://esm.sh/shiki/langs/sass.mjs"),
            import("https://esm.sh/shiki/langs/less.mjs"),
            import("https://esm.sh/shiki/langs/diff.mjs"),
          ],
          engine: createJavaScriptRegexEngine(),
        })
        setHighlighter(newHighlighter)
      } catch (error) {
        console.error("Failed to initialize highlighter:", error)
      } finally {
        setHighlighterLoading(false)
      }
    }

    void initHighlighter()
  }, [])

  return (
    <HighlighterContext.Provider value={{ highlighter, highlighterLoading }}>
      {children}
    </HighlighterContext.Provider>
  )
}

export function useHighlighter() {
  const context = useContext(HighlighterContext)
  if (!context) {
    throw new Error("useHighlighter must be used within a HighlighterProvider")
  }
  return context
}
