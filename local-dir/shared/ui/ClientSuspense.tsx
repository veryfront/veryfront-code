import { useRouter } from "@/lib/Router"
import React from "react"

export function ClientSuspense({ children, fallback }) {
  const router = useRouter()

  if (router.isMounted) {
    return <React.Suspense fallback={fallback}>{children}</React.Suspense>
  }

  return <>{children}</>
}
