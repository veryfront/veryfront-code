/**
 * @fileoverview Utilities for redirecting to project with prompt.
 */

/**
 * Redirects to a new project with the given prompt stored in session storage.
 *
 * @param prompt - Formatted prompt string
 */
export function redirectToProject(
  prompt: string,
  template?: string,
  name?: string,
): void {
  try {
    sessionStorage.setItem("prompt", prompt)

    const url = new URL("https://new.veryfront.com/")
    if (template) {
      url.searchParams.set("template", template)
    }
    if (name) {
      url.searchParams.set("name", name)
    }
    url.searchParams.set("prompt", "session")

    window.location.href = url.toString()
  } catch {
    // Fallback if sessionStorage fails
    const url = new URL("https://new.veryfront.com/")
    if (template) {
      url.searchParams.set("template", template)
    }
    if (name) {
      url.searchParams.set("name", name)
    }
    url.searchParams.set("prompt", prompt)

    window.location.href = url.toString()
  }
}
