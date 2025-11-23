import type { ImageFormat, SharpInstance } from "./types.ts";

interface FormatProcessor {
  process(image: SharpInstance, quality: number): SharpInstance;
}

class WebpProcessor implements FormatProcessor {
  process(image: SharpInstance, quality: number): SharpInstance {
    return image.webp({ quality });
  }
}

class AvifProcessor implements FormatProcessor {
  process(image: SharpInstance, quality: number): SharpInstance {
    return image.avif({ quality });
  }
}

class JpegProcessor implements FormatProcessor {
  process(image: SharpInstance, quality: number): SharpInstance {
    return image.jpeg({ quality, progressive: true });
  }
}

class PngProcessor implements FormatProcessor {
  process(image: SharpInstance, _quality: number): SharpInstance {
    return image.png({ compressionLevel: 9, adaptiveFiltering: true });
  }
}

const FORMAT_PROCESSORS: Record<ImageFormat, FormatProcessor> = {
  webp: new WebpProcessor(),
  avif: new AvifProcessor(),
  jpeg: new JpegProcessor(),
  png: new PngProcessor(),
};

export function processFormat(
  image: SharpInstance,
  format: ImageFormat,
  quality: number,
): SharpInstance {
  return FORMAT_PROCESSORS[format].process(image, quality);
}
