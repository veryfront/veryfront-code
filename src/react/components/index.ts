/**
 * React Components
 *
 * @module react/components
 */

export {
  AppWrapper,
  type AppWrapperProps,
  type MdxWrapperKind,
  MdxWrapperRenderError,
} from "./AppWrapper.tsx";
export { Head } from "./Head.tsx";
export { MDXProvider, type MDXProviderProps, useMDXComponents } from "./MDXProvider.tsx";
export {
  generateBlurDataURL,
  getAspectRatioPadding,
  OptimizedBackgroundImage,
  type OptimizedBackgroundImageProps,
  OptimizedImage,
  type OptimizedImageFormat,
  type OptimizedImageProps,
  ResponsiveImageContainer,
  SimpleOptimizedImage,
  useOptimizedImage,
  type UseOptimizedImageOptions,
} from "./optimized-image/index.ts";
