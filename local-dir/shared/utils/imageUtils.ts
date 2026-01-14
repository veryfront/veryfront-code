export function getWidths({ imageSizes = [], deviceSizes = [], width, sizes }) {
  const allSizes = [...deviceSizes, ...imageSizes].sort((a, b) => a - b)

  if (sizes) {
    // Find all the "vw" percent sizes used in the sizes prop
    const viewportWidthRe = /(^|\s)(1?\d?\d)vw/g
    const percentSizes = []
    for (let match; (match = viewportWidthRe.exec(sizes)); match) {
      percentSizes.push(parseInt(match[2]))
    }
    if (percentSizes.length) {
      const smallestRatio = Math.min(...percentSizes) * 0.01
      return {
        widths: allSizes.filter((s) => s >= deviceSizes[0] * smallestRatio),
        kind: "w",
      }
    }
    return { widths: allSizes, kind: "w" }
  }

  if (typeof width !== "number") {
    return { widths: deviceSizes, kind: "w" }
  }

  const widths = [
    ...new Set(
      // > This means that most OLED screens that say they are 3x resolution,
      // > are actually 3x in the green color, but only 1.5x in the red and
      // > blue colors. Showing a 3x resolution image in the app vs a 2x
      // > resolution image will be visually the same, though the 3x image
      // > takes significantly more data. Even true 3x resolution screens are
      // > wasteful as the human eye cannot see that level of detail without
      // > something like a magnifying glass.
      // https://blog.twitter.com/engineering/en_us/topics/infrastructure/2019/capping-image-fidelity-on-ultra-high-resolution-devices.html
      [width, width * 2 /*, width * 3*/].map(
        (w) => allSizes.find((p) => p >= w) || allSizes[allSizes.length - 1],
      ),
    ),
  ]

  return { widths, kind: "x" }
}

export function generateImgAttrs({
  imageSizes,
  deviceSizes,
  src,
  unoptimized,
  width,
  quality,
  sizes,
  loader,
}) {
  if (unoptimized) {
    return { src }
  }

  const { widths, kind } = getWidths({ imageSizes, deviceSizes, width, sizes })

  const last = widths.length - 1

  return {
    sizes: !sizes && kind === "w" ? "100vw" : sizes,
    srcSet: widths
      .map(
        (w, i) =>
          `${loader({ src, quality, width: w })} ${
            kind === "w" ? w : i + 1
          }${kind}`,
      )
      .join(", "),
    // It's intended to keep `src` the last attribute because React updates
    // attributes in order. If we keep `src` the first one, Safari will
    // immediately start to fetch `src`, before `sizes` and `srcSet` are even
    // updated by React. That causes multiple unnecessary requests if `srcSet`
    // and `sizes` are defined.
    // This bug cannot be reproduced in Chrome or Firefox.
    src: loader({ src, quality, width: widths[last] }),
  }
}

export function getImageBlurSvg({
  widthInt,
  heightInt,
  blurWidth,
  blurHeight,
  blurDataURL,
}) {
  const std = blurWidth && blurHeight ? "1" : "20"
  const svgWidth = blurWidth || widthInt
  const svgHeight = blurHeight || heightInt
  const feComponentTransfer = blurDataURL.startsWith("data:image/jpeg")
    ? `%3CfeComponentTransfer%3E%3CfeFuncA type='discrete' tableValues='1 1'/%3E%3C/feComponentTransfer%3E%`
    : ""
  if (svgWidth && svgHeight) {
    return `%3Csvg xmlns='http%3A//www.w3.org/2000/svg' viewBox='0 0 ${svgWidth} ${svgHeight}'%3E%3Cfilter id='b' color-interpolation-filters='sRGB'%3E%3CfeGaussianBlur stdDeviation='${std}'/%3E${feComponentTransfer}%3C/filter%3E%3Cimage preserveAspectRatio='none' filter='url(%23b)' x='0' y='0' height='100%25' width='100%25' href='${blurDataURL}'/%3E%3C/svg%3E`
  }
  return `%3Csvg xmlns='http%3A//www.w3.org/2000/svg'%3E%3Cimage style='filter:blur(20px)' x='0' y='0' height='100%25' width='100%25' href='${blurDataURL}'/%3E%3C/svg%3E`
}

export function getInteger(x) {
  if (typeof x === "number" || typeof x === "undefined") {
    return x
  }
  if (typeof x === "string" && /^[0-9]+$/.test(x)) {
    return parseInt(x, 10)
  }
  return NaN
}

export function getLinkPreloadProps({ src, srcSet, sizes, crossOrigin }) {
  // Note how we omit the `href` attribute, as it would only be relevant
  // for browsers that do not support `imagesrcset`, and in those cases
  // it would likely cause the incorrect image to be preloaded.
  //
  // https://html.spec.whatwg.org/multipage/semantics.html#attr-link-imagesrcset
  const linkProps = {
    key: "vf-img-" + src + srcSet + sizes,
    rel: "preload",
    as: "image",
    href: srcSet ? undefined : src,
  }
  if (srcSet) {
    linkProps.imageSrcSet = srcSet
  }
  if (sizes) {
    linkProps.imageSizes = sizes
  }
  if (crossOrigin) {
    linkProps.crossOrigin = crossOrigin
  }
  return linkProps
}

export const placeholderSrcSuffix =
  "https://cdn.veryfront.com/images/Veryfront-Placeholder"

export const placeholderImageStyles = `
*:has(> img[src*="${placeholderSrcSuffix}"]) {
  position: relative;
}

*:has(> img[src*="${placeholderSrcSuffix}"])::before {
  content: "";
  position: absolute;
  inset: 0;
  background-color: hsl(var(--primary));
  mix-blend-mode: hue;
  pointer-events: none;
  z-index: 10;
}
`.trim()
