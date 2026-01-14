import { useIsTouch } from "@/shared/hooks/useIsTouch"
import videojs from "https://esm.sh/video.js"
import { ResponsiveImage } from "@/shared/ui/ResponsiveImage"
import { AspectRatio } from "@/shared/ui/AspectRatio"
import React from "react"

export function PlayButton(props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="92"
      height="92"
      viewBox="24 20 92 92"
      fill="none"
      {...props}
    >
      <circle cx="70" cy="66" r="46" fill="#413EC2" fillOpacity="0.6" />
      <circle cx="70" cy="66" r="45" stroke="#514EF2" strokeWidth="2" />
      <path
        d="M60 51.4484C60 49.8323 61.8175 48.8836 63.1434 49.8075L84.0298 64.361C85.172 65.1569 85.172 66.8471 84.0298 67.6429L63.1434 82.1964C61.8174 83.1204 60 82.1716 60 80.5555L60 51.4484Z"
        fill="white"
      />
    </svg>
  )
}

export function PlayButtonHover(props) {
  return (
    <svg
      height="70"
      viewBox="0 0 70 70"
      width="70"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <g fill="none" fillRule="evenodd">
        <path d="m44 35.5-13 8.5v-17z" fill="#fff" fillRule="nonzero" />
      </g>
    </svg>
  )
}

export function useVideoJs({ disabled, options, onReady }) {
  const videoRef = React.useRef(null)
  const playerRef = React.useRef(null)

  React.useEffect(() => {
    if (disabled) {
      return
    }

    // Make sure Video.js player is only initialized once
    if (!playerRef.current) {
      // The Video.js player needs to be _inside_ the component el for React 18 Strict Mode.
      const videoElement = document.createElement("video-js")

      videoElement.classList.add("vjs-big-play-centered")
      videoRef.current.appendChild(videoElement)

      const player = (playerRef.current = videojs(videoElement, options, () => {
        onReady && onReady(player)
      }))

      // You could update an existing player in the `else` block here
      // on prop change, for example:
    } else {
      const player = playerRef.current
      player.autoplay(options.autoplay)
      player.src(options.sources)
    }
  }, [disabled])

  React.useEffect(() => {
    if (disabled) {
      return
    }

    const player = playerRef.current

    return () => {
      if (player && !player.isDisposed()) {
        player.dispose()
        playerRef.current = null
      }
    }
  }, [])

  return {
    ref: videoRef,
    player: playerRef,
  }
}

export function VideoPlayer(props) {
  const {
    options,
    onReady = () => null,
    previewOptions,
    onPreviewReady = () => null,
    previewImageSrc,
    previewImageAlt,
    previewImageProps,
    aspectRatio = "4:3",
    rounded = true,
  } = props

  const [isVideoActive, setIsVideoActive] = React.useState(false)

  const video = useVideoJs({
    disabled: !options,
    options: {
      bigPlayButton: false,
      aspectRatio,
      ...options,
    },
    onReady,
  })

  const preview = useVideoJs({
    disabled: !previewOptions,
    options: {
      autoplay: false,
      controls: false,
      aspectRatio,
      ...previewOptions,
    },
    onReady: onPreviewReady,
  })

  const isTouch = useIsTouch()

  function onMouseOver() {
    preview.player.current?.play()
  }

  function onMouseOut() {
    preview.player.current?.pause()
  }

  function onPlay() {
    video.player.current?.play()
    preview.player.current?.dispose()
    setIsVideoActive(true)
  }

  const [width, height] = aspectRatio.split(":")
  const ratio = [width, height].join(" / ")

  return (
    <AspectRatio
      style={{
        "--ratio": ratio,
      }}
      className={`aspect-[--ratio] group overflow-hidden${rounded ? " rounded-lg" : ""}`}
      onMouseOver={!isTouch && !isVideoActive ? onMouseOver : null}
      onMouseOut={!isTouch && !isVideoActive ? onMouseOut : null}
    >
      {previewImageSrc && !isVideoActive && (
        <div className="absolute inset-0 transition-opacity group-hover:opacity-0 group-hover:pointer-events-none isolate z-20">
          <ResponsiveImage
            src={previewImageSrc}
            alt={previewImageAlt || "Video Poster"}
            fill={true}
            {...previewImageProps}
          />
        </div>
      )}

      {previewOptions && !isVideoActive && (
        <div className="absolute inset-0 transition-opacity z-20">
          <div data-vjs-player>
            <div ref={preview.ref} />
          </div>
        </div>
      )}

      {options && (
        <div className="absolute inset-0 transition-opacity z-10">
          <div data-vjs-player>
            <div ref={video.ref} />
          </div>
        </div>
      )}

      {options && !isVideoActive && (
        <button
          aria-label="Play Video"
          className="absolute inset-0 transition-opacity z-30 flex items-center justify-center w-full h-full rounded-full"
          onClick={onPlay}
        >
          <PlayButton className="size-22 backdrop-blur-sm rounded-full overflow-hidden group-hover:backdrop-blur-lg" />
        </button>
      )}
    </AspectRatio>
  )
}
