export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/tiff',
] as const;

export const ALLOWED_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.xlsx',
  '.txt',
  '.md',
  '.markdown',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.tif',
  '.tiff',
] as const;

/** Default max upload size: 50 MB */
export const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
