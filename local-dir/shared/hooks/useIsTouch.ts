import { useEffect, useState } from "react"

export function useIsTouch() {
  const [isTouch, setIsTouch] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia("(hover: none)")

    setIsTouch(mediaQuery.matches)

    const handleChange = (event) => {
      setIsTouch(event.matches)
    }

    mediaQuery.addEventListener("change", handleChange)

    return () => {
      mediaQuery.removeEventListener("change", handleChange)
    }
  }, [])

  return isTouch
}
