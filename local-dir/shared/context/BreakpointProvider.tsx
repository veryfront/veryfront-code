import React from "react"

export const breakpointsMap = {
  phoneLandscape: "480px",
  smallTablet: "640px",
  tablet: "768px",
  wideTablet: "900px",
  desktop: "1024px",
  wide: "1350px",
  mega: "1600px",
}

export const mediaQueries = {
  isAbovePhoneLandscape: `(min-width: ${breakpointsMap.phoneLandscape})`,
  isAboveSmallTablet: `(min-width: ${breakpointsMap.smallTablet})`,
  isAboveTablet: `(min-width: ${breakpointsMap.tablet})`,
  isAboveWideTablet: `(min-width: ${breakpointsMap.wideTablet})`,
  isAboveDesktop: `(min-width: ${breakpointsMap.desktop})`,
  isAboveLarge: `(min-width: 1180px)`,
  isTouch: "(hover: none)",
}

export const BreakpointContext = React.createContext({})

export const BreakpointConsumer = BreakpointContext.Consumer

export function useBreakpoints() {
  return React.useContext(BreakpointContext)
}

export const BreakpointProvider = ({ children, queries = mediaQueries }) => {
  const [queryMatch, setQueryMatch] = React.useState({})

  React.useEffect(() => {
    const mediaQueryLists = {}
    const keys = Object.keys(queries)
    // To check whether event listener is attached or not
    let isAttached = false
    const handleQueryListener = () => {
      const updatedMatches = keys.reduce((acc, media) => {
        acc[media] = !!(
          mediaQueryLists[media] && mediaQueryLists[media].matches
        )
        return acc
      }, {})
      // Setting state to the updated matches
      // when document either starts or stops matching a query
      setQueryMatch(updatedMatches)
    }
    if (window && window.matchMedia) {
      const matches = {}
      keys.forEach((media) => {
        if (typeof queries[media] === "string") {
          mediaQueryLists[media] = window.matchMedia(queries[media])
          matches[media] = mediaQueryLists[media].matches
        } else {
          matches[media] = false
        }
      })
      // Setting state to initial matching queries
      setQueryMatch(matches)
      isAttached = true
      keys.forEach((media) => {
        if (typeof queries[media] === "string") {
          mediaQueryLists[media].addListener(handleQueryListener)
        }
      })
    }
    return () => {
      // If event listener is attached then remove it when deps change
      if (isAttached) {
        keys.forEach((media) => {
          if (typeof queries[media] === "string") {
            mediaQueryLists[media].removeListener(handleQueryListener)
          }
        })
      }
    }
  }, [queries])

  return (
    <BreakpointContext.Provider value={queryMatch}>
      {children}
    </BreakpointContext.Provider>
  )
}
