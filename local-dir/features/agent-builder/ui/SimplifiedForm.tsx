/**
 * @fileoverview Simplified form component for general requests.
 */

import { useState, useEffect, useRef } from "react"
import { redirectToProject } from "../utils/redirectToProject"

/**
 * Simplified form with just a text input and submit button.
 *
 * @returns Simplified form
 *
 * @example
 * <SimplifiedForm />
 */
export function SimplifiedForm() {
  const [input, setInput] = useState("")
  const [isRedirecting, setIsRedirecting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const isTouchDevice =
      "ontouchstart" in window || navigator.maxTouchPoints > 0

    if (!isTouchDevice && inputRef.current) {
      inputRef.current.focus({ preventScroll: true })
    }
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!input.trim()) {
      return
    }

    try {
      setIsRedirecting(true)
      redirectToProject(input, "ai-agent")
    } catch (error) {
      console.error("Failed to submit form:", error)
      setIsRedirecting(false)
    }
  }

  const handlePromptSelect = (prompt: string) => {
    setInput(prompt)
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="absolute bottom-24 h-16 left-1/2 -translate-x-1/2 w-[90%] max-w-[900px] z-10 flex items-center gap-2 bg-background py-3 px-4 rounded-2xl shadow-lg dark:shadow-[0_0_15px_rgba(26,188,254,0.15)]"
    >
      {isRedirecting && (
        <div className="absolute inset-0 z-20 bg-background/80 backdrop-blur-sm rounded-2xl flex items-center justify-center text-sm text-gray-700 dark:text-gray-300">
          Redirecting
        </div>
      )}

      <input
        ref={inputRef}
        type="text"
        className="flex-1 border-none outline-none text-base text-input-foreground bg-transparent px-2 placeholder:text-gray-600 dark:placeholder:text-gray-400"
        placeholder="What should your agent do?"
        aria-label="Project request"
        disabled={isRedirecting}
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />

      <button
        type="submit"
        disabled={isRedirecting || !input.trim()}
        className="bg-primary border-none w-10 h-10 rounded-full flex items-center justify-center cursor-pointer transition-opacity hover:opacity-80 text-white disabled:cursor-not-allowed"
        aria-label="Submit"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </button>
    </form>
  )
}
