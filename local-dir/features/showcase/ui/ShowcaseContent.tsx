import { AnimatePresence, motion } from "https://esm.sh/framer-motion"
import { Button, LoadingButton } from "@/shared/ui/Button"
import type { ShowcaseItem } from "./types"

export function ShowcaseContent({ item }: { item: ShowcaseItem }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={item.projectSlug}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        className="space-y-6 md:space-y-8 px-4 lg:px-0"
      >
        <h3 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
          {item.title}
        </h3>

        <p className="text-base md:text-lg text-gray-600 leading-relaxed">
          {item.description}
        </p>

        {/* Features */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
            Key Features
          </h4>
          <div className="grid grid-cols-1 gap-2 md:gap-3">
            {item.features.map((feature, index) => (
              <motion.div
                key={feature}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + index * 0.08, duration: 0.25 }}
                className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100"
              >
                <div className="w-2 h-2 bg-primary rounded-full" />
                <span className="text-sm font-medium text-gray-700">
                  {feature}
                </span>
              </motion.div>
            ))}
          </div>
        </div>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 pt-4">
          <Button size="lg" variant="secondary" className="sm:flex-1">
            Preview
          </Button>
          <LoadingButton size="lg" className="sm:flex-1">
            Use Template
          </LoadingButton>
        </div>

        <p className="block md:hidden text-center text-xs text-gray-400 pt-1">
          ← Swipe to explore more agents →
        </p>
      </motion.div>
    </AnimatePresence>
  )
}
