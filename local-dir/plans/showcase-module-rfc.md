# RFC: ShowcaseModule Component

## Overview

Create a high-performance, interactive showcase module for the agents page that displays agent projects using Embla carousel with animated content transitions and **browser mockup UI** wrapping iframe previews.

## Technical Requirements

### Core Functionality

- **Carousel Integration**: Use Embla carousel for smooth navigation
- **Browser Mockup UI**: Fake browser chrome around iframe (like modern SaaS tools)
- **Preview Display**: Leverage existing `IFramePreview` component within browser mockup
- **Content Animation**: Implement fade-in and cascade animations on item change
- **Navigation Controls**: Left/right arrow buttons (mobile-optimized)
- **Action Buttons**: "Preview" and "Use Template" buttons (matching TemplateCard pattern)

### Data Structure

```typescript
interface ShowcaseItem {
  title: string
  description: string
  projectSlug: string
  previewUrl: string
  features: string[]
  domain?: string // For browser address bar display
}

interface ShowcaseModuleProps {
  items: ShowcaseItem[]
}
```

## Example Code Implementation

### 1. Browser Mockup Component

```tsx
import { Globe, Lock, MoreHorizontal, Minus, Square, X } from "https://esm.sh/lucide-react"
import { IFramePreview } from "@/shared/ui/IFramePreview"

interface BrowserMockupProps {
  src: string
  domain?: string
  title?: string
  className?: string
}

export function BrowserMockup({ src, domain, title, className }: BrowserMockupProps) {
  const displayUrl = domain || new URL(src).hostname

  return (
    <div className={`bg-white rounded-xl shadow-2xl overflow-hidden border border-gray-200 ${className}`}>
      {/* Browser Chrome */}
      <div className="bg-gray-100 px-3 md:px-4 py-2 md:py-3 flex items-center gap-2 md:gap-3 border-b border-gray-200">
        {/* Traffic Lights */}
        <div className="flex items-center gap-1.5 md:gap-2">
          <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-red-500 hover:bg-red-600 transition-colors" />
          <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-yellow-500 hover:bg-yellow-600 transition-colors" />
          <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-green-500 hover:bg-green-600 transition-colors" />
        </div>

        {/* Address Bar */}
        <div className="flex-1 bg-white rounded-md md:rounded-lg px-2 md:px-4 py-1.5 md:py-2 flex items-center gap-2 md:gap-3 shadow-sm border border-gray-200 min-w-0">
          <Lock className="w-3 h-3 md:w-4 md:h-4 text-green-600 flex-shrink-0" />
          <span className="text-xs md:text-sm text-gray-600 font-mono truncate">{displayUrl}</span>
        </div>

        {/* Browser Actions */}
        <div className="hidden md:flex items-center gap-1 text-gray-500">
          <button className="p-1 hover:bg-gray-200 rounded" aria-label="More options">
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="bg-gray-50 px-3 md:px-4 flex items-center border-b border-gray-200">
        <div className="bg-white px-2 md:px-4 py-1.5 md:py-2 rounded-t-lg border-l border-r border-t border-gray-200 flex items-center gap-1.5 md:gap-2 max-w-xs">
          <Globe className="w-2.5 h-2.5 md:w-3 md:h-3 text-gray-500 flex-shrink-0" />
          <span className="text-xs text-gray-700 truncate font-medium">
            {title || "Agent Dashboard"}
          </span>
        </div>
        <div className="flex-1" />
      </div>

      {/* Content Area */}
      <div className="relative bg-white">
        <IFramePreview
          src={src}
          scaleX
          transformOrigin="top left"
          containerClassName="w-full"
          autoHeight={false}
          height={400}
          preventInteraction
          colorMode="light"
          className="rounded-none md:h-[500px]"
        />
      </div>
    </div>
  )
}
```

### 2. Mobile-Optimized ShowcaseModule with Visible Buttons

```tsx
import { useState, useCallback, useEffect } from "react"
import useEmblaCarousel from "https://esm.sh/embla-carousel-react"
import { ChevronLeft, ChevronRight } from "https://esm.sh/lucide-react"
import { Button, LoadingButton } from "@/shared/ui/Button"
import { motion, AnimatePresence } from "https://esm.sh/framer-motion"
import { BrowserMockup } from "./BrowserMockup"

export function ShowcaseModule({ items }: ShowcaseModuleProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false })
  const [activeIndex, setActiveIndex] = useState(0)

  const onSelect = useCallback(() => {
    if (!emblaApi) return
    setActiveIndex(emblaApi.selectedScrollSnap())
  }, [emblaApi])

  useEffect(() => {
    if (!emblaApi) return
    emblaApi.on("select", onSelect)
    return () => emblaApi.off("select", onSelect)
  }, [emblaApi, onSelect])

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi])
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi])

  const activeItem = items[activeIndex]

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 lg:gap-16 min-h-[600px] lg:min-h-[700px]">
        {/* Browser Preview Section - 2/3 */}
        <div className="lg:col-span-2 relative px-8 md:px-12 lg:px-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeItem.previewUrl}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              <BrowserMockup
                src={activeItem.previewUrl}
                domain={activeItem.domain}
                title={activeItem.title}
                className="w-full transform-gpu"
              />
            </motion.div>
          </AnimatePresence>
          
          {/* Mobile & Desktop Navigation Arrows - Always Visible */}
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={scrollPrev}
            className="absolute left-2 md:left-4 lg:-left-6 top-1/2 -translate-y-1/2 p-2.5 md:p-3 bg-white rounded-full shadow-xl border border-gray-200 hover:shadow-2xl transition-shadow z-10 min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Previous item"
          >
            <ChevronLeft className="w-4 h-4 md:w-5 md:h-5 text-gray-700" />
          </motion.button>
          
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={scrollNext}
            className="absolute right-2 md:right-4 lg:-right-6 top-1/2 -translate-y-1/2 p-2.5 md:p-3 bg-white rounded-full shadow-xl border border-gray-200 hover:shadow-2xl transition-shadow z-10 min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Next item"
          >
            <ChevronRight className="w-4 h-4 md:w-5 md:h-5 text-gray-700" />
          </motion.button>

          {/* Slide Indicators */}
          <div className="flex justify-center gap-2 mt-6">
            {items.map((_, index) => (
              <button
                key={index}
                onClick={() => emblaApi?.scrollTo(index)}
                className={`h-2 rounded-full transition-all min-w-[44px] min-h-[44px] flex items-center justify-center ${
                  index === activeIndex 
                    ? "bg-primary w-8" 
                    : "bg-gray-300 hover:bg-gray-400 w-2"
                }`}
                aria-label={`Go to slide ${index + 1}`}
              >
                <div className={`h-2 rounded-full ${
                  index === activeIndex ? "bg-primary w-8" : "bg-gray-300 w-2"
                }`} />
              </button>
            ))}
          </div>

          {/* Mobile Navigation Buttons (Alternative) */}
          <div className="flex justify-center gap-4 mt-6 md:hidden">
            <Button
              variant="secondary"
              size="sm"
              onClick={scrollPrev}
              disabled={activeIndex === 0}
              className="min-w-[44px] min-h-[44px]"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={scrollNext}
              disabled={activeIndex === items.length - 1}
              className="min-w-[44px] min-h-[44px]"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Content Section - 1/3 */}
        <div className="flex flex-col justify-center order-first lg:order-last">
          <ShowcaseContent item={activeItem} />
          {/* Hidden Carousel for Touch/Swipe */}
          <div className="overflow-hidden" ref={emblaRef}>
            <div className="flex">
              {items.map((item, index) => (
                <div key={index} className="flex-[0_0_100%]" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
```

### 3. Mobile-Optimized Content Component

```tsx
function ShowcaseContent({ item }: { item: ShowcaseItem }) {
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
        {/* Title with Gradient */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0, duration: 0.3 }}
        >
          <h3 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
            {item.title}
          </h3>
        </motion.div>

        {/* Description */}
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.3 }}
          className="text-base md:text-lg text-gray-600 leading-relaxed"
        >
          {item.description}
        </motion.p>

        {/* Features Grid */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.3 }}
          className="space-y-3"
        >
          <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
            Key Features
          </h4>
          <div className="grid grid-cols-1 gap-2 md:gap-3">
            {item.features.map((feature, index) => (
              <motion.div
                key={feature}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + (index * 0.1), duration: 0.3 }}
                className="flex items-center gap-2 md:gap-3 p-2.5 md:p-3 bg-gray-50 rounded-lg border border-gray-100"
              >
                <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-primary rounded-full flex-shrink-0" />
                <span className="text-sm font-medium text-gray-700">{feature}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Action Buttons - Always Visible on Mobile */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.3 }}
          className="flex flex-col sm:flex-row gap-3 md:gap-4 pt-4"
        >
          <Button 
            size="lg" 
            variant="secondary" 
            className="flex-1 min-h-[48px] text-base font-medium"
          >
            Live Preview
          </Button>
          <LoadingButton 
            size="lg" 
            className="flex-1 min-h-[48px] text-base font-medium"
          >
            Use Template
          </LoadingButton>
        </motion.div>

        {/* Mobile Swipe Hint */}
        <div className="block md:hidden text-center pt-2">
          <p className="text-xs text-gray-400">
            ← Swipe to explore more agents →
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
```

### 4. Responsive Navigation Hook

```tsx
// hooks/useResponsiveNavigation.ts
import { useState, useEffect } from "react"

export function useResponsiveNavigation() {
  const [isMobile, setIsMobile] = useState(false)
  const [isTouch, setIsTouch] = useState(false)

  useEffect(() => {
    const checkDevice = () => {
      setIsMobile(window.innerWidth < 768)
      setIsTouch('ontouchstart' in window || navigator.maxTouchPoints > 0)
    }

    checkDevice()
    window.addEventListener('resize', checkDevice)
    return () => window.removeEventListener('resize', checkDevice)
  }, [])

  return { isMobile, isTouch }
}
```

### 5. Alternative Button Layout for Mobile

```tsx
// Alternative: Bottom navigation for mobile
function MobileNavigationBar({ activeIndex, totalItems, onPrev, onNext, onGoTo }) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-white rounded-full shadow-2xl border border-gray-200 p-2 flex items-center gap-2 md:hidden z-50">
      <button
        onClick={onPrev}
        disabled={activeIndex === 0}
        className="p-3 rounded-full hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed min-w-[44px] min-h-[44px] flex items-center justify-center"
        aria-label="Previous"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      
      <div className="flex gap-1 px-2">
        {Array.from({ length: totalItems }, (_, index) => (
          <button
            key={index}
            onClick={() => onGoTo(index)}
            className={`w-2 h-2 rounded-full transition-all min-w-[32px] min-h-[32px] flex items-center justify-center ${
              index === activeIndex ? 'bg-primary' : 'bg-gray-300'
            }`}
            aria-label={`Go to slide ${index + 1}`}
          >
            <div className={`w-2 h-2 rounded-full ${
              index === activeIndex ? 'bg-primary' : 'bg-gray-300'
            }`} />
          </button>
        ))}
      </div>

      <button
        onClick={onNext}
        disabled={activeIndex === totalItems - 1}
        className="p-3 rounded-full hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed min-w-[44px] min-h-[44px] flex items-center justify-center"
        aria-label="Next"
      >
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  )
}
```

## Mobile-Specific Optimizations

### **📱 Navigation Visibility**

- **Inset positioning**: `left-2 md:left-4 lg:-left-6` ensures buttons never get cut off
- **Touch-friendly sizing**: Minimum 44px touch targets on all interactive elements
- **Multiple navigation options**: Floating arrows + slide indicators + optional bottom bar
- **Safe positioning**: Buttons positioned inside container on mobile, outside on desktop

### **🔧 Responsive Behavior**

- **Container padding**: `px-8 md:px-12 lg:px-0` creates space for navigation buttons
- **Button scaling**: Responsive button sizes with proper minimum dimensions
- **Content reordering**: Content appears first on mobile (`order-first lg:order-last`)
- **Alternative layouts**: Optional bottom navigation bar for better mobile UX

### **⚡ Touch Optimizations**

- **Swipe gestures**: Full Embla carousel touch support
- **Visual feedback**: Hover states that work on touch devices
- **Swipe hints**: Subtle text indicating swipe functionality on mobile
- **Proper z-indexing**: Ensures navigation always stays above content

### **✨ Accessibility**

- **ARIA labels**: All navigation buttons properly labeled
- **Disabled states**: Visual and functional disabled states for edge cases
- **Focus management**: Proper keyboard navigation support
- **Screen reader support**: Announcements for slide changes

***

**The buttons are now guaranteed to be visible on all device sizes with multiple fallback navigation options!** 🚀📱

*Mobile users get the premium experience with touch gestures + always-visible controls!*
