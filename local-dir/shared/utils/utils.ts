import { clsx } from "https://esm.sh/clsx@1.2.1"
import { twMerge } from "https://esm.sh/tailwind-merge@1.12.0"
import { cva } from "https://esm.sh/class-variance-authority@0.6.0"

export const slugify = (str) =>
  str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export { clsx, twMerge, cva }
