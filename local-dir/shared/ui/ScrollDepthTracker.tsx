import { useRouter } from "@/lib/Router"
import debounceFn from "https://esm.sh/lodash.debounce@4.0.8"
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
} from "react"

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect

function getScrollPercentage() {
  if (typeof window === "undefined") {
    return 0
  }
  //
  const doc = document.documentElement
  const body = document.body
  //
  const currentScroll = Math.max(
    window.pageYOffset,
    doc.scrollTop,
    body.scrollTop,
  )
  const scrollableHeight = Math.max(
    doc.scrollHeight,
    body.scrollHeight,
    doc.offsetHeight,
    body.offsetHeight,
  )
  const clientHeight = doc.clientHeight
  const scrollableDistance = scrollableHeight - clientHeight
  //
  if (scrollableDistance <= 0) {
    return 100
  }
  //
  const scrollPercentage = (currentScroll / scrollableDistance) * 100
  //
  return scrollPercentage
}

function getCurrentDepth(scrollDepths) {
  const scrollPercentage = getScrollPercentage()
  return scrollDepths.filter((depth) => depth <= scrollPercentage).pop() || 0
}

export function useScrollDepth(
  {
    onDepthReached,
    scrollDepths = [10, 25, 50, 75],
    triggerDepthsAbove = true,
    triggerOnce = true,
    disabled = false,
    debounce = 200,
    triggerOnLoad = true,
  },
  deps = [],
) {
  const remainingDepthsRef = useRef(scrollDepths)
  //
  useIsomorphicLayoutEffect(() => {
    if (disabled) {
      return
    }
    // Reset hook when custom deps array changes
    remainingDepthsRef.current = scrollDepths
  }, [disabled, scrollDepths, ...deps])
  //
  const calculateScrollPosition = useCallback(() => {
    const remainingDepths = remainingDepthsRef.current
    // Get % scrolled
    const scrollPercentage = getScrollPercentage()
    // Get current depth
    const currentDepth = getCurrentDepth(scrollDepths)
    // Trigger callbacks
    if (onDepthReached && currentDepth) {
      const callbackDepths = triggerDepthsAbove
        ? remainingDepths.filter((depth) => depth <= scrollPercentage)
        : [currentDepth]
      //
      for (const key in callbackDepths) {
        onDepthReached({
          depth: callbackDepths[key],
          percentage: scrollPercentage,
        })
      }
    }
    // Update remaining depths cache (if `triggerOnce` set)
    const updatedRemainingDepths = triggerOnce
      ? remainingDepths.filter((depth) => depth > scrollPercentage)
      : scrollDepths
    //
    remainingDepthsRef.current = updatedRemainingDepths
  }, [scrollDepths, onDepthReached, triggerDepthsAbove, triggerOnce])
  //
  useIsomorphicLayoutEffect(() => {
    if (disabled) {
      return
    }
    //
    const removeHandlers = () => {
      window.removeEventListener("scroll", handleScroll)
    }
    //
    const handleScroll = debounceFn(() => {
      // If no more depths to track, unmount
      if (!remainingDepthsRef?.current.length) {
        removeHandlers()
        return
      }
      //
      calculateScrollPosition()
    }, debounce)
    //
    window.addEventListener("scroll", handleScroll, { passive: true })
    //
    return removeHandlers
  }, [disabled, debounce, calculateScrollPosition, ...deps])
  //
  useIsomorphicLayoutEffect(() => {
    if (disabled || !triggerOnLoad) {
      return
    }
    // Reset hook when custom deps array changes
    calculateScrollPosition()
  }, [disabled, triggerOnLoad, calculateScrollPosition, ...deps])
}

export function ScrollDepthTracker({ children, ...options }) {
  const router = useRouter()
  useScrollDepth(options, [router.pathname])

  return <>{children}</>
}
