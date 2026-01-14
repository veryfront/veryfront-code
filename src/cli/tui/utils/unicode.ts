// deno-lint-ignore-file no-explicit-any
/**
 * Unicode Width Utilities
 *
 * Calculate the display width of Unicode strings, accounting for
 * wide characters (CJK), combining marks, and emoji.
 */

// ============================================================================
// Character Width Tables
// ============================================================================

/**
 * Characters that have zero width (combining marks, etc.)
 * Ranges derived from Unicode character database
 */
const ZERO_WIDTH_RANGES: [number, number][] = [
  [0x0300, 0x036f], // Combining Diacritical Marks
  [0x0483, 0x0489], // Combining Cyrillic
  [0x0591, 0x05bd], // Hebrew combining marks
  [0x05bf, 0x05bf],
  [0x05c1, 0x05c2],
  [0x05c4, 0x05c5],
  [0x05c7, 0x05c7],
  [0x0610, 0x061a], // Arabic combining marks
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06dc],
  [0x06df, 0x06e4],
  [0x06e7, 0x06e8],
  [0x06ea, 0x06ed],
  [0x0711, 0x0711], // Syriac
  [0x0730, 0x074a],
  [0x07a6, 0x07b0], // Thaana
  [0x07eb, 0x07f3], // NKo
  [0x0816, 0x0819], // Samaritan
  [0x081b, 0x0823],
  [0x0825, 0x0827],
  [0x0829, 0x082d],
  [0x0859, 0x085b], // Mandaic
  [0x08e3, 0x0902], // Arabic Extended
  [0x093a, 0x093a], // Devanagari
  [0x093c, 0x093c],
  [0x0941, 0x0948],
  [0x094d, 0x094d],
  [0x0951, 0x0957],
  [0x0962, 0x0963],
  [0x0981, 0x0981], // Bengali
  [0x09bc, 0x09bc],
  [0x09c1, 0x09c4],
  [0x09cd, 0x09cd],
  [0x09e2, 0x09e3],
  [0x0a01, 0x0a02], // Gurmukhi
  [0x0a3c, 0x0a3c],
  [0x0a41, 0x0a42],
  [0x0a47, 0x0a48],
  [0x0a4b, 0x0a4d],
  [0x0a51, 0x0a51],
  [0x0a70, 0x0a71],
  [0x0a75, 0x0a75],
  [0x0a81, 0x0a82], // Gujarati
  [0x0abc, 0x0abc],
  [0x0ac1, 0x0ac5],
  [0x0ac7, 0x0ac8],
  [0x0acd, 0x0acd],
  [0x0ae2, 0x0ae3],
  [0x0b01, 0x0b01], // Oriya
  [0x0b3c, 0x0b3c],
  [0x0b3f, 0x0b3f],
  [0x0b41, 0x0b44],
  [0x0b4d, 0x0b4d],
  [0x0b56, 0x0b56],
  [0x0b62, 0x0b63],
  [0x0b82, 0x0b82], // Tamil
  [0x0bc0, 0x0bc0],
  [0x0bcd, 0x0bcd],
  [0x0c00, 0x0c00], // Telugu
  [0x0c3e, 0x0c40],
  [0x0c46, 0x0c48],
  [0x0c4a, 0x0c4d],
  [0x0c55, 0x0c56],
  [0x0c62, 0x0c63],
  [0x0c81, 0x0c81], // Kannada
  [0x0cbc, 0x0cbc],
  [0x0cbf, 0x0cbf],
  [0x0cc6, 0x0cc6],
  [0x0ccc, 0x0ccd],
  [0x0ce2, 0x0ce3],
  [0x0d01, 0x0d01], // Malayalam
  [0x0d41, 0x0d44],
  [0x0d4d, 0x0d4d],
  [0x0d62, 0x0d63],
  [0x0dca, 0x0dca], // Sinhala
  [0x0dd2, 0x0dd4],
  [0x0dd6, 0x0dd6],
  [0x0e31, 0x0e31], // Thai
  [0x0e34, 0x0e3a],
  [0x0e47, 0x0e4e],
  [0x0eb1, 0x0eb1], // Lao
  [0x0eb4, 0x0eb9],
  [0x0ebb, 0x0ebc],
  [0x0ec8, 0x0ecd],
  [0x0f18, 0x0f19], // Tibetan
  [0x0f35, 0x0f35],
  [0x0f37, 0x0f37],
  [0x0f39, 0x0f39],
  [0x0f71, 0x0f7e],
  [0x0f80, 0x0f84],
  [0x0f86, 0x0f87],
  [0x0f8d, 0x0f97],
  [0x0f99, 0x0fbc],
  [0x0fc6, 0x0fc6],
  [0x102d, 0x1030], // Myanmar
  [0x1032, 0x1037],
  [0x1039, 0x103a],
  [0x103d, 0x103e],
  [0x1058, 0x1059],
  [0x105e, 0x1060],
  [0x1071, 0x1074],
  [0x1082, 0x1082],
  [0x1085, 0x1086],
  [0x108d, 0x108d],
  [0x109d, 0x109d],
  [0x135d, 0x135f], // Ethiopic
  [0x1712, 0x1714], // Tagalog
  [0x1732, 0x1734], // Hanunoo
  [0x1752, 0x1753], // Buhid
  [0x1772, 0x1773], // Tagbanwa
  [0x17b4, 0x17b5], // Khmer
  [0x17b7, 0x17bd],
  [0x17c6, 0x17c6],
  [0x17c9, 0x17d3],
  [0x17dd, 0x17dd],
  [0x180b, 0x180d], // Mongolian
  [0x1885, 0x1886],
  [0x18a9, 0x18a9],
  [0x1920, 0x1922], // Limbu
  [0x1927, 0x1928],
  [0x1932, 0x1932],
  [0x1939, 0x193b],
  [0x1a17, 0x1a18], // Buginese
  [0x1a1b, 0x1a1b],
  [0x1a56, 0x1a56], // Tai Tham
  [0x1a58, 0x1a5e],
  [0x1a60, 0x1a60],
  [0x1a62, 0x1a62],
  [0x1a65, 0x1a6c],
  [0x1a73, 0x1a7c],
  [0x1a7f, 0x1a7f],
  [0x1ab0, 0x1abe], // Combining Diacritical Marks Extended
  [0x1b00, 0x1b03], // Balinese
  [0x1b34, 0x1b34],
  [0x1b36, 0x1b3a],
  [0x1b3c, 0x1b3c],
  [0x1b42, 0x1b42],
  [0x1b6b, 0x1b73],
  [0x1b80, 0x1b81], // Sundanese
  [0x1ba2, 0x1ba5],
  [0x1ba8, 0x1ba9],
  [0x1bab, 0x1bad],
  [0x1be6, 0x1be6], // Batak
  [0x1be8, 0x1be9],
  [0x1bed, 0x1bed],
  [0x1bef, 0x1bf1],
  [0x1c2c, 0x1c33], // Lepcha
  [0x1c36, 0x1c37],
  [0x1cd0, 0x1cd2], // Vedic Extensions
  [0x1cd4, 0x1ce0],
  [0x1ce2, 0x1ce8],
  [0x1ced, 0x1ced],
  [0x1cf4, 0x1cf4],
  [0x1cf8, 0x1cf9],
  [0x1dc0, 0x1df5], // Combining Diacritical Marks Supplement
  [0x1dfc, 0x1dff],
  [0x20d0, 0x20f0], // Combining Diacritical Marks for Symbols
  [0x2cef, 0x2cf1], // Coptic
  [0x2d7f, 0x2d7f], // Tifinagh
  [0x2de0, 0x2dff], // Cyrillic Extended-A
  [0x302a, 0x302d], // CJK Symbols
  [0x3099, 0x309a], // Hiragana combining
  [0xa66f, 0xa672], // Combining Cyrillic
  [0xa674, 0xa67d],
  [0xa69e, 0xa69f],
  [0xa6f0, 0xa6f1], // Bamum
  [0xa802, 0xa802], // Syloti Nagri
  [0xa806, 0xa806],
  [0xa80b, 0xa80b],
  [0xa825, 0xa826],
  [0xa8c4, 0xa8c4], // Saurashtra
  [0xa8e0, 0xa8f1], // Devanagari Extended
  [0xa926, 0xa92d], // Kayah Li
  [0xa947, 0xa951], // Rejang
  [0xa980, 0xa982], // Javanese
  [0xa9b3, 0xa9b3],
  [0xa9b6, 0xa9b9],
  [0xa9bc, 0xa9bc],
  [0xa9e5, 0xa9e5], // Myanmar Extended-B
  [0xaa29, 0xaa2e], // Cham
  [0xaa31, 0xaa32],
  [0xaa35, 0xaa36],
  [0xaa43, 0xaa43],
  [0xaa4c, 0xaa4c],
  [0xaa7c, 0xaa7c], // Myanmar Extended-A
  [0xaab0, 0xaab0], // Tai Viet
  [0xaab2, 0xaab4],
  [0xaab7, 0xaab8],
  [0xaabe, 0xaabf],
  [0xaac1, 0xaac1],
  [0xaaec, 0xaaed], // Meetei Mayek Extensions
  [0xaaf6, 0xaaf6],
  [0xabe5, 0xabe5], // Meetei Mayek
  [0xabe8, 0xabe8],
  [0xabed, 0xabed],
  [0xfb1e, 0xfb1e], // Hebrew
  [0xfe00, 0xfe0f], // Variation Selectors
  [0xfe20, 0xfe2f], // Combining Half Marks
  [0x101fd, 0x101fd], // Phaistos Disc
  [0x102e0, 0x102e0], // Coptic Epact Numbers
  [0x10376, 0x1037a], // Old Permic
  [0x10a01, 0x10a03], // Kharoshthi
  [0x10a05, 0x10a06],
  [0x10a0c, 0x10a0f],
  [0x10a38, 0x10a3a],
  [0x10a3f, 0x10a3f],
  [0x10ae5, 0x10ae6], // Manichaean
  [0x11001, 0x11001], // Brahmi
  [0x11038, 0x11046],
  [0x1107f, 0x11081], // Kaithi
  [0x110b3, 0x110b6],
  [0x110b9, 0x110ba],
  [0x11100, 0x11102], // Chakma
  [0x11127, 0x1112b],
  [0x1112d, 0x11134],
  [0x11173, 0x11173], // Mahajani
  [0x11180, 0x11181], // Sharada
  [0x111b6, 0x111be],
  [0x111ca, 0x111cc],
  [0x1122f, 0x11231], // Khojki
  [0x11234, 0x11234],
  [0x11236, 0x11237],
  [0x112df, 0x112df], // Khudawadi
  [0x112e3, 0x112ea],
  [0x11300, 0x11301], // Grantha
  [0x1133c, 0x1133c],
  [0x11340, 0x11340],
  [0x11366, 0x1136c],
  [0x11370, 0x11374],
  [0x114b3, 0x114b8], // Tirhuta
  [0x114ba, 0x114ba],
  [0x114bf, 0x114c0],
  [0x114c2, 0x114c3],
  [0x115b2, 0x115b5], // Siddham
  [0x115bc, 0x115bd],
  [0x115bf, 0x115c0],
  [0x115dc, 0x115dd],
  [0x11633, 0x1163a], // Modi
  [0x1163d, 0x1163d],
  [0x1163f, 0x11640],
  [0x116ab, 0x116ab], // Takri
  [0x116ad, 0x116ad],
  [0x116b0, 0x116b5],
  [0x116b7, 0x116b7],
  [0x1171d, 0x1171f], // Ahom
  [0x11722, 0x11725],
  [0x11727, 0x1172b],
  [0x16af0, 0x16af4], // Bassa Vah
  [0x16b30, 0x16b36], // Pahawh Hmong
  [0x16f8f, 0x16f92], // Miao
  [0x1bc9d, 0x1bc9e], // Duployan
  [0x1d167, 0x1d169], // Musical Symbols
  [0x1d17b, 0x1d182],
  [0x1d185, 0x1d18b],
  [0x1d1aa, 0x1d1ad],
  [0x1d242, 0x1d244], // Combining Greek Musical Symbols
  [0x1da00, 0x1da36], // Sutton SignWriting
  [0x1da3b, 0x1da6c],
  [0x1da75, 0x1da75],
  [0x1da84, 0x1da84],
  [0x1da9b, 0x1da9f],
  [0x1daa1, 0x1daaf],
  [0x1e000, 0x1e006], // Glagolitic Supplement
  [0x1e008, 0x1e018],
  [0x1e01b, 0x1e021],
  [0x1e023, 0x1e024],
  [0x1e026, 0x1e02a],
  [0x1e8d0, 0x1e8d6], // Mende Kikakui
  [0x1e944, 0x1e94a], // Adlam
  [0xe0100, 0xe01ef], // Variation Selectors Supplement
];

/**
 * Wide characters (typically CJK) that take 2 columns
 */
const WIDE_RANGES: [number, number][] = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x231a, 0x231b], // Watch, Hourglass
  [0x2329, 0x232a], // Angle brackets
  [0x23e9, 0x23f3], // Various symbols
  [0x23f8, 0x23fa],
  [0x25fd, 0x25fe], // Medium squares
  [0x2614, 0x2615], // Umbrella, Hot Beverage
  [0x2648, 0x2653], // Zodiac
  [0x267f, 0x267f], // Wheelchair
  [0x2693, 0x2693], // Anchor
  [0x26a1, 0x26a1], // High Voltage
  [0x26aa, 0x26ab], // Circles
  [0x26bd, 0x26be], // Soccer, Baseball
  [0x26c4, 0x26c5], // Snowman, Sun
  [0x26ce, 0x26ce], // Ophiuchus
  [0x26d4, 0x26d4], // No Entry
  [0x26ea, 0x26ea], // Church
  [0x26f2, 0x26f3], // Fountain, Golf
  [0x26f5, 0x26f5], // Sailboat
  [0x26fa, 0x26fa], // Tent
  [0x26fd, 0x26fd], // Fuel Pump
  [0x2702, 0x2702], // Scissors
  [0x2705, 0x2705], // Check Mark
  [0x2708, 0x270d], // Airplane, etc.
  [0x270f, 0x270f], // Pencil
  [0x2712, 0x2712], // Black Nib
  [0x2714, 0x2714], // Check Mark
  [0x2716, 0x2716], // X Mark
  [0x271d, 0x271d], // Latin Cross
  [0x2721, 0x2721], // Star of David
  [0x2728, 0x2728], // Sparkles
  [0x2733, 0x2734], // Eight Spoked Asterisk
  [0x2744, 0x2744], // Snowflake
  [0x2747, 0x2747], // Sparkle
  [0x274c, 0x274c], // Cross Mark
  [0x274e, 0x274e], // Cross Mark
  [0x2753, 0x2755], // Question Mark
  [0x2757, 0x2757], // Exclamation Mark
  [0x2763, 0x2764], // Heart Exclamation
  [0x2795, 0x2797], // Plus, Minus, Division
  [0x27a1, 0x27a1], // Right Arrow
  [0x27b0, 0x27b0], // Curly Loop
  [0x27bf, 0x27bf], // Double Curly Loop
  [0x2934, 0x2935], // Arrows
  [0x2b05, 0x2b07], // Arrows
  [0x2b1b, 0x2b1c], // Squares
  [0x2b50, 0x2b50], // Star
  [0x2b55, 0x2b55], // Circle
  [0x2e80, 0x2e99], // CJK Radicals Supplement
  [0x2e9b, 0x2ef3],
  [0x2f00, 0x2fd5], // Kangxi Radicals
  [0x2ff0, 0x2ffb], // Ideographic Description
  [0x3000, 0x303e], // CJK Symbols and Punctuation
  [0x3041, 0x3096], // Hiragana
  [0x3099, 0x30ff], // Katakana
  [0x3105, 0x312f], // Bopomofo
  [0x3131, 0x318e], // Hangul Compatibility Jamo
  [0x3190, 0x31ba], // Kanbun
  [0x31c0, 0x31e3], // CJK Strokes
  [0x31f0, 0x321e], // Katakana Phonetic Extensions
  [0x3220, 0x3247], // Enclosed CJK Letters
  [0x3250, 0x32fe], // Enclosed CJK Letters
  [0x3300, 0x4dbf], // CJK Compatibility
  [0x4e00, 0xa48c], // CJK Unified Ideographs
  [0xa490, 0xa4c6], // Yi Radicals
  [0xa960, 0xa97c], // Hangul Jamo Extended-A
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe10, 0xfe19], // Vertical Forms
  [0xfe30, 0xfe52], // CJK Compatibility Forms
  [0xfe54, 0xfe66], // Small Form Variants
  [0xfe68, 0xfe6b],
  [0xff01, 0xff60], // Fullwidth Forms
  [0xffe0, 0xffe6], // Fullwidth Forms
  [0x16fe0, 0x16fe1], // Ideographic Symbols
  [0x17000, 0x187f1], // Tangut
  [0x18800, 0x18af2], // Tangut Components
  [0x1b000, 0x1b11e], // Kana Supplement
  [0x1b170, 0x1b2fb], // Nushu
  [0x1f004, 0x1f004], // Mahjong Tile
  [0x1f0cf, 0x1f0cf], // Playing Card
  [0x1f18e, 0x1f18e], // Negative Squared AB
  [0x1f191, 0x1f19a], // Squared CL, etc.
  [0x1f200, 0x1f202], // Enclosed Ideographic
  [0x1f210, 0x1f23b],
  [0x1f240, 0x1f248],
  [0x1f250, 0x1f251],
  [0x1f260, 0x1f265],
  [0x1f300, 0x1f64f], // Miscellaneous Symbols and Pictographs, Emoticons
  [0x1f680, 0x1f6ff], // Transport and Map Symbols
  [0x1f900, 0x1f9ff], // Supplemental Symbols and Pictographs
  [0x1fa00, 0x1fa6f], // Chess Symbols
  [0x1fa70, 0x1faff], // Symbols and Pictographs Extended-A
  [0x20000, 0x2fffd], // CJK Unified Ideographs Extension B-F
  [0x30000, 0x3fffd], // CJK Unified Ideographs Extension G
];

// ============================================================================
// Binary Search Helpers
// ============================================================================

function inRanges(codePoint: number, ranges: [number, number][]): boolean {
  let low = 0;
  let high = ranges.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const range = ranges[mid];

    if (codePoint < range[0]) {
      high = mid - 1;
    } else if (codePoint > range[1]) {
      low = mid + 1;
    } else {
      return true;
    }
  }

  return false;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the display width of a single code point
 */
export function charWidth(codePoint: number): number {
  // ASCII printable characters
  if (codePoint >= 0x20 && codePoint < 0x7f) {
    return 1;
  }

  // Control characters
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) {
    return 0;
  }

  // Soft hyphen
  if (codePoint === 0xad) {
    return 1;
  }

  // Zero-width characters
  if (inRanges(codePoint, ZERO_WIDTH_RANGES)) {
    return 0;
  }

  // Wide characters
  if (inRanges(codePoint, WIDE_RANGES)) {
    return 2;
  }

  // Default to 1
  return 1;
}

/**
 * Get the display width of a string
 */
export function stringWidth(str: string): number {
  // Strip ANSI codes first
  // deno-lint-ignore no-control-regex
  const stripped = str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");

  let width = 0;

  for (const char of stripped) {
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined) {
      width += charWidth(codePoint);
    }
  }

  return width;
}

/**
 * Truncate a string to fit within a maximum display width
 */
export function truncateToWidth(str: string, maxWidth: number, suffix = "..."): string {
  const suffixWidth = stringWidth(suffix);

  if (maxWidth < suffixWidth) {
    return "";
  }

  const targetWidth = maxWidth - suffixWidth;
  let width = 0;
  let result = "";
  let needsTruncation = false;

  for (const char of str) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) continue;

    const charW = charWidth(codePoint);

    if (width + charW > targetWidth) {
      needsTruncation = true;
      break;
    }

    width += charW;
    result += char;
  }

  if (needsTruncation) {
    return result + suffix;
  }

  return str;
}

/**
 * Pad a string to a specific display width
 */
export function padToWidth(
  str: string,
  targetWidth: number,
  padChar = " ",
  align: "left" | "right" | "center" = "left",
): string {
  const currentWidth = stringWidth(str);

  if (currentWidth >= targetWidth) {
    return str;
  }

  const padding = targetWidth - currentWidth;

  switch (align) {
    case "right":
      return padChar.repeat(padding) + str;
    case "center": {
      const leftPad = Math.floor(padding / 2);
      const rightPad = padding - leftPad;
      return padChar.repeat(leftPad) + str + padChar.repeat(rightPad);
    }
    default: // left
      return str + padChar.repeat(padding);
  }
}

/**
 * Wrap text to fit within a maximum display width
 */
export function wrapText(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  const words = text.split(/\s+/);

  let currentLine = "";
  let currentWidth = 0;

  for (const word of words) {
    const wordWidth = stringWidth(word);

    if (currentWidth === 0) {
      // First word on line
      if (wordWidth > maxWidth) {
        // Word is too long, need to break it
        let remaining = word;
        while (remaining) {
          const chunk = truncateToWidth(remaining, maxWidth, "");
          lines.push(chunk);
          remaining = remaining.slice(chunk.length);
        }
      } else {
        currentLine = word;
        currentWidth = wordWidth;
      }
    } else if (currentWidth + 1 + wordWidth <= maxWidth) {
      // Word fits on current line
      currentLine += " " + word;
      currentWidth += 1 + wordWidth;
    } else {
      // Word doesn't fit, start new line
      lines.push(currentLine);
      if (wordWidth > maxWidth) {
        let remaining = word;
        while (remaining) {
          const chunk = truncateToWidth(remaining, maxWidth, "");
          lines.push(chunk);
          remaining = remaining.slice(chunk.length);
        }
        currentLine = "";
        currentWidth = 0;
      } else {
        currentLine = word;
        currentWidth = wordWidth;
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Split a string at a specific display width
 */
export function splitAtWidth(str: string, width: number): [string, string] {
  let currentWidth = 0;
  let splitIndex = 0;

  for (const char of str) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) continue;

    const charW = charWidth(codePoint);

    if (currentWidth + charW > width) {
      break;
    }

    currentWidth += charW;
    splitIndex += char.length;
  }

  return [str.slice(0, splitIndex), str.slice(splitIndex)];
}
