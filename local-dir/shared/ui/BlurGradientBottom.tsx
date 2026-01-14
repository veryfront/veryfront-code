import { useState, useEffect } from "react"

export function BlurGradientBottom() {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY
      const windowHeight = window.innerHeight
      const documentHeight = document.documentElement.scrollHeight

      // Show when scrolled down from top (not at the very top)
      const hasScrolled = scrollY > 100

      // Hide when footer is in viewport (assuming footer height is around 200px)
      const footerHeight = 200
      const isFooterVisible =
        scrollY + windowHeight >= documentHeight - footerHeight

      setIsVisible(hasScrolled && !isFooterVisible)
    }

    window.addEventListener("scroll", handleScroll, { passive: true })
    handleScroll() // Check initial state

    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  if (!isVisible) return null

  return (
    <div className="fixed inset-x-0 bottom-0 h-32 z-30 pointer-events-none">
      <div className="absolute inset-0 overflow-hidden">
        {/* Layer 1 - Lightest blur */}
        <div
          className="absolute inset-0 z-[1] pointer-events-none"
          style={{
            maskImage:
              "linear-gradient(rgba(0, 0, 0, 0) 0%, rgb(0, 0, 0) 12.5%, rgb(0, 0, 0) 25%, rgba(0, 0, 0, 0) 37.5%)",
            backdropFilter: "blur(0.1875px)",
          }}
        />

        {/* Layer 2 */}
        <div
          className="absolute inset-0 z-[2] pointer-events-none"
          style={{
            maskImage:
              "linear-gradient(rgba(0, 0, 0, 0) 12.5%, rgb(0, 0, 0) 25%, rgb(0, 0, 0) 37.5%, rgba(0, 0, 0, 0) 50%)",
            backdropFilter: "blur(0.375px)",
          }}
        />

        {/* Layer 3 */}
        <div
          className="absolute inset-0 z-[3] pointer-events-none"
          style={{
            maskImage:
              "linear-gradient(rgba(0, 0, 0, 0) 25%, rgb(0, 0, 0) 37.5%, rgb(0, 0, 0) 50%, rgba(0, 0, 0, 0) 62.5%)",
            backdropFilter: "blur(0.75px)",
          }}
        />

        {/* Layer 4 */}
        <div
          className="absolute inset-0 z-[4] pointer-events-none"
          style={{
            maskImage:
              "linear-gradient(rgba(0, 0, 0, 0) 37.5%, rgb(0, 0, 0) 50%, rgb(0, 0, 0) 62.5%, rgba(0, 0, 0, 0) 75%)",
            backdropFilter: "blur(1.5px)",
          }}
        />

        {/* Layer 5 */}
        <div
          className="absolute inset-0 z-[5] pointer-events-none"
          style={{
            maskImage:
              "linear-gradient(rgba(0, 0, 0, 0) 50%, rgb(0, 0, 0) 62.5%, rgb(0, 0, 0) 75%, rgba(0, 0, 0, 0) 87.5%)",
            backdropFilter: "blur(3px)",
          }}
        />

        {/* Layer 6 */}
        <div
          className="absolute inset-0 z-[6] pointer-events-none"
          style={{
            maskImage:
              "linear-gradient(rgba(0, 0, 0, 0) 62.5%, rgb(0, 0, 0) 75%, rgb(0, 0, 0) 87.5%, rgba(0, 0, 0, 0) 100%)",
            backdropFilter: "blur(6px)",
          }}
        />

        {/* Layer 7 */}
        <div
          className="absolute inset-0 z-[7] pointer-events-none"
          style={{
            maskImage:
              "linear-gradient(rgba(0, 0, 0, 0) 75%, rgb(0, 0, 0) 87.5%, rgb(0, 0, 0) 100%)",
            backdropFilter: "blur(12px)",
          }}
        />

        {/* Layer 8 - Strongest blur */}
        <div
          className="absolute inset-0 z-[8] pointer-events-none"
          style={{
            maskImage:
              "linear-gradient(rgba(0, 0, 0, 0) 87.5%, rgb(0, 0, 0) 100%)",
            backdropFilter: "blur(24px)",
          }}
        />
      </div>
    </div>
  )
}
