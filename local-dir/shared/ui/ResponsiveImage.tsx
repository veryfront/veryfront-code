import { Image } from "@/shared/ui/Image"

export const imageSizes = [16, 32, 48, 64, 96, 128, 256, 384]

export const deviceSizes = [
  320, 380, 420, 640, 750, 828, 1080, 1200, 1440, 1920, 2048, 3840,
]

export const defaultLoader = ({ src, width, quality, params, extension }) => {
  const imageProxyUrl = "https://images.veryfront.com/imgproxy"
  const args = [`q:${quality || 75}`, `w:${width}`]

  if (params?.length) {
    args.push(...params)
  }

  const argsString = args.join("/")
  const base64Src = btoa(src)
  const fileExtension = extension ?? ".webp"

  return `${imageProxyUrl}/${argsString}/${base64Src}${fileExtension}`
}

export function ResponsiveImage({ params, style, ...props }) {
  const loaderFunction = props.loader || defaultLoader
  const loader = (loaderProps) => loaderFunction({ ...loaderProps, params })

  let computedStyle = {
    width: "100%",
    height: "auto",
  }

  if (props.fill) {
    computedStyle = {
      objectFit: "cover",
    }
  }

  if (style === null) {
    computedStyle = {}
  } else {
    computedStyle = {
      ...computedStyle,
      ...style,
    }
  }

  return (
    <Image
      style={computedStyle}
      imageSizes={imageSizes}
      deviceSizes={deviceSizes}
      {...props}
      loader={loader}
    />
  )
}
