/**
 * @fileoverview Submit button component.
 */

/**
 * Circular submit button with arrow icon.
 */
export function SubmitButton() {
  return (
    <button
      className="bg-black border-none w-10 h-10 rounded-full flex items-center justify-center cursor-pointer transition-opacity hover:opacity-80 text-white"
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
  )
}
