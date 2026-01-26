export function processFormat(image, format, quality) {
    switch (format) {
        case "webp":
            return image.webp({ quality });
        case "avif":
            return image.avif({ quality });
        case "jpeg":
            return image.jpeg({ quality, progressive: true });
        case "png":
            return image.png({ compressionLevel: 9, adaptiveFiltering: true });
        default:
            return image;
    }
}
