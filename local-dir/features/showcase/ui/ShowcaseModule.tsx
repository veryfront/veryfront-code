import { useState, useCallback, useEffect } from "react"
import useEmblaCarousel from "https://esm.sh/embla-carousel-react"
import { ChevronLeft, ChevronRight } from "https://esm.sh/lucide-react"
import { motion, AnimatePresence } from "https://esm.sh/framer-motion"

import { BrowserMockup } from "./BrowserMockup"
import { ShowcaseContent } from "./ShowcaseContent"
import type { ShowcaseModuleProps } from "../utils/types"

export function ShowcaseModule({ items }: ShowcaseModuleProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false })
  const [activeIndex, setActiveIndex] = useState(0)

  const onSelect = useCallback(() => {
    if (emblaApi) setActiveIndex(emblaApi.selectedScrollSnap())
  }, [emblaApi])

  useEffect(() => {
    emblaApi?.on("select", onSelect)
    return () => emblaApi?.off("select", onSelect)
  }, [emblaApi, onSelect])

  const scrollPrev = () => emblaApi?.scrollPrev()
  const scrollNext = () => emblaApi?.scrollNext()

  const item = items[activeIndex]

  if (!item) {
    return null
  }

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-16 min-h-[600px] lg:min-h-[700px]">
        <div className="lg:col-span-2 relative px-8 md:px-12 lg:px-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={item.previewUrl}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              <BrowserMockup
                src={item.previewUrl}
                domain={item.domain}
                title={item.title}
              />
            </motion.div>
          </AnimatePresence>

          {/* Navigation Buttons */}
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={scrollPrev}
            className="absolute left-2 md:left-4 lg:-left-6 top-1/2 -translate-y-1/2 p-3 bg-white rounded-full shadow-xl border border-gray-200"
          >
            <ChevronLeft className="w-5 h-5 text-gray-700" />
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={scrollNext}
            className="absolute right-2 md:right-4 lg:-right-6 top-1/2 -translate-y-1/2 p-3 bg-white rounded-full shadow-xl border border-gray-200"
          >
            <ChevronRight className="w-5 h-5 text-gray-700" />
          </motion.button>

          {/* Slide Indicators */}
          <div className="flex justify-center gap-2 mt-6">
            {items.map((_, i) => (
              <button
                key={i}
                onClick={() => emblaApi?.scrollTo(i)}
                className={`h-2 w-8 rounded-full transition-all ${
                  activeIndex === i
                    ? "bg-primary"
                    : "bg-gray-300 hover:bg-gray-400"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col justify-center">
          <ShowcaseContent item={item} />

          {/* Hidden Swipe Track */}
          <div className="overflow-hidden" ref={emblaRef}>
            <div className="flex">
              {items.map((_, idx) => (
                <div key={idx} className="flex-[0_0_100%]" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
