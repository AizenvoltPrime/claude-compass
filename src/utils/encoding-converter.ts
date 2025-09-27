import { createComponentLogger } from './logger';

const logger = createComponentLogger('encoding-converter');

/**
 * Result of encoding detection
 */
export interface EncodingDetectionResult {
  detectedEncoding: string;
  hasIssues: boolean;
  hasBOM: boolean;
  bomBytes?: Buffer;
  metadata?: {
    nullBytes: number;
    replacementChars: number;
    controlChars: number;
    highBitChars: number;
    averageByteValue: number;
    suspiciousPatterns: string[];
  };
}

/**
 * BOM (Byte Order Mark) definitions for different encodings
 */
const BOM_SIGNATURES = {
  'utf-8': Buffer.from([0xef, 0xbb, 0xbf]),
  'utf-16be': Buffer.from([0xfe, 0xff]),
  'utf-16le': Buffer.from([0xff, 0xfe]),
  'utf-32be': Buffer.from([0x00, 0x00, 0xfe, 0xff]),
  'utf-32le': Buffer.from([0xff, 0xfe, 0x00, 0x00]),
} as const;

/**
 * Common encoding patterns for detection
 */
const ENCODING_PATTERNS = {
  'windows-1252': {
    // Common Windows-1252 characters that differ from ISO-8859-1
    characteristics: [
      0x80, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8e, 0x91, 0x92,
      0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9e, 0x9f,
    ],
    name: 'Windows-1252',
  },
  'iso-8859-1': {
    // ISO-8859-1 (Latin-1) characteristics
    characteristics: [],
    name: 'ISO-8859-1',
  },
} as const;

/**
 * Utility class for encoding detection and conversion
 */
export class EncodingConverter {
  /**
   * Detect the encoding of a buffer using multiple detection methods
   */
  static async detectEncoding(buffer: Buffer): Promise<EncodingDetectionResult> {
    try {
      // Step 1: Check for BOM
      const bomResult = this.detectBOM(buffer);
      if (bomResult.hasBOM) {
        return {
          detectedEncoding: bomResult.detectedEncoding!,
          hasIssues: false,
          hasBOM: bomResult.hasBOM,
          bomBytes: bomResult.bomBytes,
          metadata: bomResult.metadata,
        };
      }

      // Step 2: Statistical analysis
      const stats = this.analyzeBuffer(buffer);

      // Step 3: UTF-8 validation
      const utf8Result = this.validateUTF8(buffer);
      if (utf8Result.isValid) {
        return {
          detectedEncoding: 'utf-8',
          hasIssues: stats.replacementChars > 0,
          hasBOM: false,
          metadata: stats,
        };
      }

      // Step 4: UTF-16 detection (without BOM)
      const utf16Result = this.detectUTF16(buffer);
      if (utf16Result.encoding !== 'utf-8') {
        return {
          detectedEncoding: utf16Result.encoding,
          hasIssues: false,
          hasBOM: false,
          metadata: stats,
        };
      }

      // Step 5: Extended ASCII detection (Windows-1252 vs ISO-8859-1)
      const extendedResult = this.detectExtendedASCII(buffer, stats);

      return {
        ...extendedResult,
        hasIssues: stats.replacementChars > 0 || stats.nullBytes > 0,
        hasBOM: false,
        metadata: stats,
      };
    } catch (error) {
      logger.error('Encoding detection failed', { error: (error as Error).message });

      return {
        detectedEncoding: 'utf-8',
        hasIssues: true,
        hasBOM: false,
        metadata: {
          nullBytes: 0,
          replacementChars: 0,
          controlChars: 0,
          highBitChars: 0,
          averageByteValue: 0,
          suspiciousPatterns: ['detection-failed'],
        },
      };
    }
  }

  /**
   * Convert a buffer to UTF-8 string using detected or specified encoding
   */
  static async convertToUtf8(buffer: Buffer, sourceEncoding?: string): Promise<string> {
    try {
      let encoding = sourceEncoding;

      // Auto-detect if not specified
      if (!encoding) {
        const detection = await this.detectEncoding(buffer);
        encoding = detection.detectedEncoding;
      }

      // Remove BOM if present
      const cleanBuffer = this.removeBOMFromBuffer(buffer);

      // Convert based on detected/specified encoding
      let result: string;

      switch (encoding.toLowerCase()) {
        case 'utf-8':
          result = cleanBuffer.toString('utf8');
          break;

        case 'utf-16le':
        case 'utf-16':
          result = cleanBuffer.toString('utf16le');
          break;

        case 'utf-16be':
          // Node.js doesn't directly support UTF-16BE, so we need to swap bytes
          result = this.convertUTF16BE(cleanBuffer);
          break;

        case 'windows-1252':
        case 'cp1252':
          result = this.convertWindows1252(cleanBuffer);
          break;

        case 'iso-8859-1':
        case 'latin1':
          result = cleanBuffer.toString('latin1');
          break;

        case 'ascii':
          result = cleanBuffer.toString('ascii');
          break;

        default:
          logger.warn('Unknown encoding, falling back to UTF-8', { encoding });
          result = cleanBuffer.toString('utf8');
          break;
      }

      // Clean up the result
      result = this.normalizeLineEndings(result);
      result = this.cleanUpString(result);

      return result;
    } catch (error) {
      logger.error('Encoding conversion failed', {
        error: (error as Error).message,
        sourceEncoding,
      });

      // Fallback: try to salvage what we can
      return this.fallbackConversion(buffer);
    }
  }

  /**
   * Remove BOM from string content
   */
  static removeBOM(content: string): string {
    // UTF-8 BOM as string
    if (content.charCodeAt(0) === 0xfeff) {
      return content.slice(1);
    }

    // UTF-8 BOM as bytes (if somehow present as characters)
    if (content.startsWith('\uFEFF')) {
      return content.slice(1);
    }

    return content;
  }

  /**
   * Normalize line endings to LF
   */
  static normalizeLineEndings(content: string): string {
    return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  /**
   * Detect BOM from buffer
   */
  private static detectBOM(buffer: Buffer): Partial<EncodingDetectionResult> {
    for (const [encoding, bomSignature] of Object.entries(BOM_SIGNATURES)) {
      if (buffer.length >= bomSignature.length) {
        const bufferStart = buffer.slice(0, bomSignature.length);
        if (bufferStart.equals(bomSignature)) {
          return {
            detectedEncoding: encoding,
            hasBOM: true,
            bomBytes: bomSignature,
          };
        }
      }
    }

    return {
      hasBOM: false,
    };
  }

  /**
   * Remove BOM from buffer
   */
  private static removeBOMFromBuffer(buffer: Buffer): Buffer {
    for (const bomSignature of Object.values(BOM_SIGNATURES)) {
      if (buffer.length >= bomSignature.length) {
        const bufferStart = buffer.slice(0, bomSignature.length);
        if (bufferStart.equals(bomSignature)) {
          return buffer.slice(bomSignature.length);
        }
      }
    }
    return buffer;
  }

  /**
   * Analyze buffer for encoding characteristics
   */
  private static analyzeBuffer(buffer: Buffer) {
    let nullBytes = 0;
    let replacementChars = 0;
    let controlChars = 0;
    let highBitChars = 0;
    let totalByteValue = 0;
    const suspiciousPatterns: string[] = [];

    const sampleSize = Math.min(buffer.length, 4096); // Analyze first 4KB for performance
    const sample = buffer.slice(0, sampleSize);

    for (let i = 0; i < sample.length; i++) {
      const byte = sample[i];
      totalByteValue += byte;

      if (byte === 0) {
        nullBytes++;
      } else if (byte === 0xfd || byte === 0xff) {
        replacementChars++;
      } else if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
        controlChars++;
      } else if (byte > 127) {
        highBitChars++;
      }
    }

    // Check for suspicious patterns
    const sampleStr = sample.toString('binary');
    if (nullBytes > sampleSize * 0.1) {
      suspiciousPatterns.push('high-null-bytes');
    }
    if (controlChars > sampleSize * 0.05) {
      suspiciousPatterns.push('high-control-chars');
    }
    if (sampleStr.includes('\uFFFD')) {
      suspiciousPatterns.push('replacement-characters');
    }

    return {
      nullBytes,
      replacementChars,
      controlChars,
      highBitChars,
      averageByteValue: totalByteValue / sampleSize,
      suspiciousPatterns,
    };
  }

  /**
   * Validate if buffer is valid UTF-8
   */
  private static validateUTF8(buffer: Buffer): { isValid: boolean; issues: string[] } {
    const issues: string[] = [];

    try {
      const decoded = buffer.toString('utf8');

      // Check for replacement characters
      const replacementCount = (decoded.match(/\uFFFD/g) || []).length;
      if (replacementCount > 0) {
        issues.push(`${replacementCount} replacement characters`);
      }

      // Check UTF-8 byte sequence validity
      let validSequences = 0;
      let totalSequences = 0;

      for (let i = 0; i < buffer.length; ) {
        const byte = buffer[i];
        totalSequences++;

        if (byte < 0x80) {
          // ASCII character
          validSequences++;
          i++;
        } else if ((byte & 0xe0) === 0xc0) {
          // 2-byte sequence
          if (i + 1 < buffer.length && (buffer[i + 1] & 0xc0) === 0x80) {
            validSequences++;
          }
          i += 2;
        } else if ((byte & 0xf0) === 0xe0) {
          // 3-byte sequence
          if (
            i + 2 < buffer.length &&
            (buffer[i + 1] & 0xc0) === 0x80 &&
            (buffer[i + 2] & 0xc0) === 0x80
          ) {
            validSequences++;
          }
          i += 3;
        } else if ((byte & 0xf8) === 0xf0) {
          // 4-byte sequence
          if (
            i + 3 < buffer.length &&
            (buffer[i + 1] & 0xc0) === 0x80 &&
            (buffer[i + 2] & 0xc0) === 0x80 &&
            (buffer[i + 3] & 0xc0) === 0x80
          ) {
            validSequences++;
          }
          i += 4;
        } else {
          // Invalid UTF-8 start byte
          i++;
        }
      }

      const sequenceValidityRatio = totalSequences > 0 ? validSequences / totalSequences : 1;
      const replacementRatio = decoded.length > 0 ? replacementCount / decoded.length : 0;

      const isValid = sequenceValidityRatio > 0.8 && replacementRatio < 0.1;

      return {
        isValid,
        issues,
      };
    } catch (error) {
      return {
        isValid: false,
        issues: ['utf8-decode-error'],
      };
    }
  }

  /**
   * Detect UTF-16 encoding (LE or BE) without BOM
   */
  private static detectUTF16(buffer: Buffer): { encoding: string } {
    if (buffer.length < 4) {
      return { encoding: 'utf-8' };
    }

    // Check for UTF-16 patterns
    let leNulls = 0; // Little-endian nulls (even positions)
    let beNulls = 0; // Big-endian nulls (odd positions)
    let totalPairs = 0;

    const sampleSize = Math.min(buffer.length, 1000);
    for (let i = 0; i < sampleSize - 1; i += 2) {
      totalPairs++;
      if (buffer[i] === 0) beNulls++;
      if (buffer[i + 1] === 0) leNulls++;
    }

    const leRatio = leNulls / totalPairs;
    const beRatio = beNulls / totalPairs;

    // Strong indication of UTF-16 if many nulls in consistent positions
    if (leRatio > 0.3) {
      return { encoding: 'utf-16le' };
    }
    if (beRatio > 0.3) {
      return { encoding: 'utf-16be' };
    }

    return { encoding: 'utf-8' };
  }

  /**
   * Detect extended ASCII encoding (Windows-1252 vs ISO-8859-1)
   */
  private static detectExtendedASCII(buffer: Buffer, stats: any): { detectedEncoding: string } {
    // If no high-bit characters, it's plain ASCII (treat as UTF-8)
    if (stats.highBitChars === 0) {
      return { detectedEncoding: 'utf-8' };
    }

    // Look for Windows-1252 specific characters
    let windows1252Chars = 0;
    const sampleSize = Math.min(buffer.length, 2048);

    for (let i = 0; i < sampleSize; i++) {
      const byte = buffer[i];
      if (ENCODING_PATTERNS['windows-1252'].characteristics.includes(byte as any)) {
        windows1252Chars++;
      }
    }

    if (windows1252Chars > 0) {
      return { detectedEncoding: 'windows-1252' };
    }

    // Default to ISO-8859-1 for extended ASCII
    return { detectedEncoding: 'iso-8859-1' };
  }

  /**
   * Convert UTF-16BE buffer to string
   */
  private static convertUTF16BE(buffer: Buffer): string {
    const swapped = Buffer.alloc(buffer.length);
    for (let i = 0; i < buffer.length - 1; i += 2) {
      swapped[i] = buffer[i + 1];
      swapped[i + 1] = buffer[i];
    }
    return swapped.toString('utf16le');
  }

  /**
   * Convert Windows-1252 buffer to string
   */
  private static convertWindows1252(buffer: Buffer): string {
    // Windows-1252 to Unicode mapping for the 0x80-0x9F range
    const cp1252Map: { [key: number]: string } = {
      0x80: '\u20AC',
      0x82: '\u201A',
      0x83: '\u0192',
      0x84: '\u201E',
      0x85: '\u2026',
      0x86: '\u2020',
      0x87: '\u2021',
      0x88: '\u02C6',
      0x89: '\u2030',
      0x8a: '\u0160',
      0x8b: '\u2039',
      0x8c: '\u0152',
      0x8e: '\u017D',
      0x91: '\u2018',
      0x92: '\u2019',
      0x93: '\u201C',
      0x94: '\u201D',
      0x95: '\u2022',
      0x96: '\u2013',
      0x97: '\u2014',
      0x98: '\u02DC',
      0x99: '\u2122',
      0x9a: '\u0161',
      0x9b: '\u203A',
      0x9c: '\u0153',
      0x9e: '\u017E',
      0x9f: '\u0178',
    };

    let result = '';
    for (let i = 0; i < buffer.length; i++) {
      const byte = buffer[i];
      if (cp1252Map[byte]) {
        result += cp1252Map[byte];
      } else if (byte < 0x80 || byte > 0x9f) {
        // Standard Latin-1 character
        result += String.fromCharCode(byte);
      } else {
        // Undefined in Windows-1252, use replacement character
        result += '\uFFFD';
      }
    }

    return result;
  }

  /**
   * Clean up converted string
   */
  private static cleanUpString(content: string): string {
    // Remove or replace problematic characters
    return content
      .replace(/\x00/g, '') // Remove null characters
      .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove most control characters
      .replace(/\uFFFD+/g, '?'); // Replace runs of replacement characters with single question mark
  }

  /**
   * Fallback conversion when all else fails
   */
  private static fallbackConversion(buffer: Buffer): string {
    logger.warn('Using fallback conversion method');

    try {
      // Try Latin-1 as last resort
      const latin1 = buffer.toString('latin1');
      return this.normalizeLineEndings(this.cleanUpString(latin1));
    } catch (error) {
      logger.error('Fallback conversion failed', { error: (error as Error).message });

      // Ultimate fallback: binary conversion with character filtering
      let result = '';
      for (let i = 0; i < Math.min(buffer.length, 50000); i++) {
        // Limit to first 50KB
        const byte = buffer[i];
        if (byte >= 32 && byte <= 126) {
          // Printable ASCII
          result += String.fromCharCode(byte);
        } else if (byte === 10 || byte === 13 || byte === 9) {
          // Line endings and tabs
          result += String.fromCharCode(byte);
        } else {
          // Replace everything else with space
          result += ' ';
        }
      }

      return this.normalizeLineEndings(result);
    }
  }
}
