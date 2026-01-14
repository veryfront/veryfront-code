/**
 * @fileoverview Rotating hero component that cycles through integrations.
 */

import { useState, useEffect, useRef, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { motion, AnimatePresence } from "https://esm.sh/framer-motion@11"
import { ChevronDown } from "https://esm.sh/lucide-react"
import { AsciiScene } from "./AsciiScene"
import { FooterLinks } from "../ui/FooterLinks"
import { Button } from "@/shared/ui/Button"

type Integration = {
  name: string
  displayName: string
  icon: string
  description: string
  authType: string
  toolCount: number
  promptCount: number
}

const ROTATION_INTERVAL = 1500 // 1.5 seconds per integration

export interface AgentBuilderHeroProps {
  showFooter?: boolean
  enableScrollZoom?: boolean
}

/**
 * Rotating hero component that cycles through integrations.
 *
 * @param showFooter - Whether to show footer links (default: true)
 * @param enableScrollZoom - Whether to enable scroll-to-zoom in 3D scene (default: false)
 * @returns Animated rotating hero with integrations
 *
 * @example
 * <AgentBuilderHero showFooter={false} enableScrollZoom={true} />
 */
export function AgentBuilderHero({
  showFooter = false,
  enableScrollZoom = false,
}: AgentBuilderHeroProps) {
  const [currentIndex, setCurrentIndex] = useState(0)

  const { data, isLoading } = useQuery<Integration[]>({
    queryKey: ["integrations"],
    queryFn: async () => {
      const response = await fetch(
        "https://api.veryfront.com/integrations?limit=100",
      )
      if (!response.ok) {
        throw new Error("Failed to fetch integrations")
      }
      const result = await response.json()
      return Array.isArray(result.integrations) ? result.integrations : []
    },
  })

  const integrations = useMemo(() => {
    if (!data || !Array.isArray(data)) return []

    // Randomize order
    const shuffled = [...data].sort(() => Math.random() - 0.5)

    // Shorten Amazon Web Services to AWS
    return shuffled.map((integration) => ({
      ...integration,
      displayName:
        integration.displayName === "Amazon Web Services"
          ? "AWS"
          : integration.displayName,
    }))
  }, [data])

  useEffect(() => {
    if (integrations.length === 0) return

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % integrations.length)
    }, ROTATION_INTERVAL)

    return () => clearInterval(interval)
  }, [integrations.length])

  const currentIntegration = integrations[currentIndex]

  const handlePromptClick = (prompt: string) => {
    const setPrompt = (window as any).__setAgentPrompt
    if (setPrompt) {
      setPrompt(prompt)
    }
  }

  const handleScroll = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    const target = document.querySelector("#persona")
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }

  return (
    <div className="relative w-full h-full overflow-hidden">
      <AsciiScene modelType="agent" enableScrollZoom={enableScrollZoom} />

      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 text-center px-4 w-full max-w-full pointer-events-none touch-none select-none">
        <h1 className="text-5xl sm:text-6xl md:text-7xl font-medium text-foreground mb-8 break-words">
          Create your AI agent
        </h1>

        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4 text-3xl sm:text-4xl font-medium min-h-[3.75rem] sm:min-h-[5rem]">
          {!isLoading && currentIntegration && (
            <AnimatePresence mode="wait">
              <motion.div
                key={currentIndex}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="flex flex-wrap items-center justify-center gap-2 sm:gap-4"
              >
                <span>connect</span>
                <div className="flex items-center justify-center w-10 h-10 sm:w-16 sm:h-16 bg-white rounded-lg sm:rounded-xl shadow-sm border border-gray-200 shrink-0">
                  <img
                    src={`https://api.veryfront.com/integrations/${currentIntegration.name}/icon`}
                    alt={currentIntegration.displayName}
                    className="w-6 h-6 sm:w-10 sm:h-10 object-contain"
                  />
                </div>
                <span>{currentIntegration.displayName}</span>
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>

      <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-10">
        <Button
          variant="primary"
          size="lg"
          asChild
          className="hover:scale-110 transition-transform duration-200"
        >
          <a href="#configure" onClick={handleScroll}>
            Create Agent
            <ChevronDown className="w-4 h-4" />
          </a>
        </Button>
      </div>

      {showFooter && <FooterLinks />}
    </div>
  )
}
