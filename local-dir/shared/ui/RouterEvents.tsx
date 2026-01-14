import React from "react"

export function RouterEvents({
  children,
  onRouteChangeStart,
  onRouteChangeEnd,
}) {
  React.useEffect(() => {
    const originalPushState = history.pushState

    history.pushState = function (state) {
      // Before the transition
      onRouteChangeStart?.(state)

      originalPushState.apply(history, arguments)

      // After the transition
      onRouteChangeEnd?.(state)
    }

    return () => {
      // Restoring the original pushState method
      history.pushState = originalPushState
    }
  }, [])

  return children
}
