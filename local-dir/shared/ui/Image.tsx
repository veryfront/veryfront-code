import {
  getInteger,
  generateImgAttrs,
  getImageBlurSvg,
  placeholderSrcSuffix,
  placeholderImageStyles,
} from "@/shared/utils/imageUtils"
import { Head } from "@/lib/Head"
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"

function handleLoading(
  img,
  src,
  placeholder,
  onLoadRef,
  onLoadingCompleteRef,
  setBlurComplete,
) {
  // See https://stackoverflow.com/q/39777833/266535 for why we use this ref
  // handler instead of the img's onLoad attribute.
  if (!img || img["data-loaded-src"] === src) {
    return
  }

  img["data-loaded-src"] = src

  const p = "decode" in img ? img.decode() : Promise.resolve()
  p.catch(() => {
    //
  }).then(() => {
    if (!img.parentNode) {
      // Exit early in case of race condition:
      // - onload() is called
      // - decode() is called but incomplete
      // - unmount is called
      // - decode() completes
      return
    }

    if (placeholder === "blur") {
      setBlurComplete(true)
    }

    if (onLoadRef?.current) {
      // Since we don't have the SyntheticEvent here,
      // we must create one with the same shape.
      // See https://reactjs.org/docs/events.html
      const event = new Event("load")
      Object.defineProperty(event, "target", { writable: false, value: img })
      let prevented = false
      let stopped = false

      onLoadRef.current({
        ...event,
        nativeEvent: event,
        currentTarget: img,
        target: img,
        isDefaultPrevented: () => prevented,
        isPropagationStopped: () => stopped,
        persist: () => {
          //
        },
        preventDefault: () => {
          prevented = true
          event.preventDefault()
        },
        stopPropagation: () => {
          stopped = true
          event.stopPropagation()
        },
      })
    }

    if (onLoadingCompleteRef?.current) {
      onLoadingCompleteRef.current(img)
    }
  })
}

const ImageElement = forwardRef(
  (
    {
      imgAttributes,
      heightInt,
      widthInt,
      qualityInt,
      className,
      imgStyle,
      blurStyle,
      isLazy,
      fill,
      placeholder,
      loading,
      srcString,
      unoptimized,
      loader,
      onLoadRef,
      onLoadingCompleteRef,
      setBlurComplete,
      setShowAltText,
      onLoad,
      onError,
      ...props
    },
    forwardedRef,
  ) => {
    loading = isLazy ? "lazy" : loading

    useEffect(() => {
      const imgElement = forwardedRef?.current

      if (imgElement && imgElement.complete && !imgElement.naturalWidth) {
        setShowAltText(true)
        if (placeholder === "blur") {
          setBlurComplete(true)
        }
        if (onError) {
          onError(new Event("error"))
        }
      }
    }, [])

    return (
      <>
        <img
          {...props}
          {...imgAttributes}
          width={widthInt}
          height={heightInt}
          decoding="async"
          className={className}
          loading={loading}
          style={{ ...imgStyle, ...blurStyle }}
          ref={useCallback(
            (img) => {
              if (forwardedRef) {
                if (typeof forwardedRef === "function") forwardedRef(img)
                else if (typeof forwardedRef === "object") {
                  forwardedRef.current = img
                }
              }
              if (!img) {
                return
              }
              if (onError) {
                // If the image has an error before react hydrates, then the error is lost.
                // The workaround is to wait until the image is mounted which is after hydration,
                // then we set the src again to trigger the error handler (if there was an error).
                // eslint-disable-next-line no-self-assign
                img.src = img.src
              }
              // Only call handleLoading if the image is already loaded
              if (img.complete) {
                handleLoading(
                  img,
                  srcString,
                  placeholder,
                  onLoadRef,
                  onLoadingCompleteRef,
                  setBlurComplete,
                )
              }
            },
            [
              srcString,
              placeholder,
              onLoadRef,
              onLoadingCompleteRef,
              setBlurComplete,
              onError,
              forwardedRef,
            ],
          )}
          onLoad={(event) => {
            const img = event.currentTarget
            handleLoading(
              img,
              srcString,
              placeholder,
              onLoadRef,
              onLoadingCompleteRef,
              setBlurComplete,
            )
          }}
          onError={(event) => {
            // if the real image fails to load, this will ensure "alt" is visible
            setShowAltText(true)
            if (placeholder === "blur") {
              // If the real image fails to load, this will still remove the placeholder.
              setBlurComplete(true)
            }
            if (onError) {
              onError(event)
            }
          }}
        />
      </>
    )
  },
)

function getLinkPreloadProps({ src, srcSet = "", sizes = "", crossOrigin }) {
  // Note how we omit the `href` attribute, as it would only be relevant
  // for browsers that do not support `imagesrcset`, and in those cases
  // it would likely cause the incorrect image to be preloaded.
  //
  // https://html.spec.whatwg.org/multipage/semantics.html#attr-link-imagesrcset
  const linkProps = {
    rel: "preload",
    as: "image",
    fetchpriority: "high",
  }

  if (srcSet) {
    linkProps.imageSrcSet = srcSet
  } else {
    linkProps.href = src
  }

  if (sizes) {
    linkProps.imageSizes = sizes
  }

  if (crossOrigin) {
    linkProps.crossOrigin = crossOrigin
  }

  return linkProps
}

export const Image = forwardRef(
  (
    {
      src,
      sizes,
      unoptimized = false,
      priority = false,
      loading,
      className,
      quality,
      width,
      height,
      fill,
      style,
      onLoad,
      onLoadingComplete,
      placeholder = "empty",
      blurDataURL,
      loader,
      imageSizes,
      deviceSizes,
      ...props
    },
    forwardedRef,
  ) => {
    const staticSrc = ""
    const widthInt = getInteger(width)
    const heightInt = getInteger(height)

    let blurWidth
    let blurHeight
    src = typeof src === "string" ? src : staticSrc

    let isLazy =
      !priority && (loading === "lazy" || typeof loading === "undefined")

    if (src.startsWith("data:") || src.startsWith("blob:")) {
      // https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URIs
      unoptimized = true
      isLazy = false
    }
    if (src.endsWith(".svg")) {
      // Special case to make svg serve as-is to avoid proxying
      // through the built-in Image Optimization API.
      unoptimized = true
    }

    const [blurComplete, setBlurComplete] = useState(false)

    const [showAltText, setShowAltText] = useState(false)

    const qualityInt = getInteger(quality)

    const imgStyle = Object.assign(
      fill
        ? {
            position: "absolute",
            height: "100%",
            width: "100%",
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
          }
        : {},
      showAltText ? {} : { color: "transparent" },
      style,
    )

    const blurStyle =
      placeholder === "blur" && blurDataURL && !blurComplete
        ? {
            backgroundSize: imgStyle.objectFit || "cover",
            backgroundPosition: imgStyle.objectPosition || "50% 50%",
            backgroundRepeat: "no-repeat",
            backgroundImage: `url("data:image/svg+xml;charset=utf-8,${getImageBlurSvg(
              {
                widthInt,
                heightInt,
                blurWidth,
                blurHeight,
                blurDataURL,
              },
            )}")`,
          }
        : {}

    const imgAttributes = generateImgAttrs({
      imageSizes,
      deviceSizes,
      src,
      unoptimized,
      width: widthInt,
      quality: qualityInt,
      sizes,
      loader,
    })

    const srcString = src

    const onLoadRef = useRef(onLoad)

    useEffect(() => {
      onLoadRef.current = onLoad
    }, [onLoad])

    const onLoadingCompleteRef = useRef(onLoadingComplete)

    useEffect(() => {
      onLoadingCompleteRef.current = onLoadingComplete
    }, [onLoadingComplete])

    const imgElementArgs = {
      isLazy,
      imgAttributes,
      heightInt,
      widthInt,
      qualityInt,
      className,
      imgStyle,
      blurStyle,
      loading,
      fill,
      unoptimized,
      placeholder,
      loader,
      srcString,
      onLoadRef,
      onLoadingCompleteRef,
      setBlurComplete,
      setShowAltText,
      ...props,
    }

    const preloadProps = priority
      ? getLinkPreloadProps({
          src: imgAttributes.src,
          srcSet: imgAttributes.srcSet,
          sizes: imgAttributes.sizes,
          crossOrigin: props.crossOrigin,
        })
      : {}

    if (priority) {
      imgElementArgs.fetchpriority = "high"
    }

    return (
      <>
        <ImageElement {...imgElementArgs} ref={forwardedRef} />
        {priority ? (
          <Head>
            <link
              key={
                "vf-img-" +
                preloadProps.src +
                preloadProps.srcSet +
                preloadProps.sizes
              }
              {...preloadProps}
            />
          </Head>
        ) : null}
        {src?.includes(placeholderSrcSuffix) ? (
          <Head>
            <style key="vf-img-placeholder-styles">
              {placeholderImageStyles}
            </style>
          </Head>
        ) : null}
      </>
    )
  },
)
