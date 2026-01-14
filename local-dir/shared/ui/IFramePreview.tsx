import { cn } from "@/shared/utils/utils"
import { connectToChild } from "https://esm.sh/penpal@6.2.2"
import React from "react"

export function getIFrameSrc(src, colorMode = "light") {
  if (!src) {
    return ""
  }

  const iFrameUrl = new URL(src)
  iFrameUrl.searchParams.set("studio_embed", "true")
  iFrameUrl.searchParams.set("color_mode", colorMode)
  return iFrameUrl.toString()
}

export const DEFAULT_VIEWPORT = 1350

export function IFramePreview({
  src,
  lazy = true,
  margin = 100,
  viewport,
  height,
  autoHeight = true,
  scaleX = false,
  scaleY = false,
  childStyles,
  transformOrigin = "center",
  className,
  containerClassName,
  preventInteraction = false,
  colorMode = "light",
}) {
  const [iframeStatus, setIframeStatus] = React.useState("idle")
  const [iframeSrc, setIframeSrc] = React.useState(
    lazy ? "" : getIFrameSrc(src, colorMode),
  )
  const [iframeSize, setIframeSize] = React.useState({})
  const iframeRef = React.useRef(null)
  const containerRef = React.useRef(null)
  const [scaleFactor, setScaleFactor] = React.useState(null)
  const [isStyled, setIsStyled] = React.useState(false)
  const childRef = React.useRef(null)
  const shouldScale = scaleX || scaleY

  React.useEffect(() => {
    if (!lazy) {
      setIframeStatus("loading")
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && iframeSrc === "") {
          setIframeStatus("loading")
          setIframeSrc(getIFrameSrc(src, colorMode))
        }
      },
      {
        rootMargin: margin + "px",
      },
    )

    if (containerRef.current) {
      observer.observe(containerRef.current)
    }

    return () => {
      if (containerRef.current) {
        observer.unobserve(containerRef.current)
      }
      setIframeStatus("idle")
    }
  }, [src, iframeSrc, setIframeSrc, lazy])

  function calculateScaleFactor() {
    if ((scaleX || scaleY) && containerRef.current && iframeRef.current) {
      const containerWidth = containerRef.current.offsetWidth
      const containerHeight = containerRef.current.offsetHeight

      const iframeWidth = iframeRef.current.offsetWidth
      const iframeHeight = iframeRef.current.offsetHeight

      let finalScale = 1

      // Calculate scale factors for both width and height if enabled
      if (scaleX && scaleY) {
        const widthScale = containerWidth / iframeWidth
        const heightScale = containerHeight / iframeHeight

        // Choose the smaller scale factor to ensure the iframe fits in both dimensions
        finalScale = Math.min(widthScale, heightScale)
      } else if (scaleX) {
        finalScale = containerWidth / iframeWidth
      } else if (scaleY) {
        finalScale = containerHeight / iframeHeight
      }

      // Apply the scale factor only if the iframe is larger than the container
      setScaleFactor(finalScale < 1 ? finalScale : 1)
    }
  }

  React.useEffect(() => {
    window.addEventListener("resize", calculateScaleFactor)

    return () => {
      window.removeEventListener("resize", calculateScaleFactor)
    }
  }, [calculateScaleFactor])

  React.useEffect(() => {
    if (!iframeRef.current || !iframeSrc) {
      return
    }

    let disableSetSize = false

    const connection = connectToChild({
      iframe: iframeRef.current,
      methods: {
        setSize(size) {
          // Disable setSize once after styles are set
          if (childStyles && disableSetSize) {
            disableSetSize = false
            return
          }

          if (autoHeight || shouldScale) {
            setIframeSize(size)
          }

          calculateScaleFactor()
        },
      },
    })

    connection.promise.then(async (child) => {
      childRef.current = child

      if (childStyles) {
        await child.setStyle(childStyles, "html")
        const size = await child.getSize()

        setIframeSize(size)

        // Disable setSize once after styles are set
        disableSetSize = true

        if (shouldScale) {
          calculateScaleFactor()
        }

        setIsStyled(true)
      }
    })

    return () => {
      connection.destroy()
      childRef.current = null
    }
  }, [iframeSrc, setIframeSize])

  React.useEffect(() => {
    if (childRef.current) {
      childRef.current.setColorMode(colorMode)
    }
  }, [colorMode])

  const handleLoad = () => {
    if (!iframeSrc) {
      return
    }
    setIframeStatus("loaded")
  }

  const handleError = () => {
    if (!iframeSrc) {
      return
    }
    setIframeStatus("error")
  }

  const styles = {}

  let isHidden = iframeStatus !== "loaded"

  if (height) {
    styles.height = height
  }

  if (autoHeight) {
    styles.height = iframeSize.height ? iframeSize.height + "px" : 0
    isHidden = iframeSize.height ? false : true
  }

  if (shouldScale) {
    styles.width = (viewport || DEFAULT_VIEWPORT) + "px"
    styles.position = "absolute"
    styles.transform = scaleFactor ? `scale(${scaleFactor})` : null
    styles.transformOrigin = transformOrigin
    isHidden = scaleFactor ? false : true
  }

  if (childStyles) {
    if (height) {
      isHidden = isStyled ? false : true
    } else {
      isHidden = iframeSize.height && isStyled ? false : true
    }
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative overflow-hidden transition-opacity",
        isHidden ? "opacity-0" : "opacity-100",
        preventInteraction ? "pointer-events-none touch-none" : "",
        containerClassName,
      )}
    >
      <iframe
        ref={iframeRef}
        src={iframeSrc}
        className={cn("w-full scrollbar-hide", className)}
        onLoad={handleLoad}
        onError={handleError}
        style={styles}
        tabIndex="-1"
      />
    </div>
  )
}
