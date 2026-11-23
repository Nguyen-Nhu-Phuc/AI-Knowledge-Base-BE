import { createHash, randomBytes } from 'crypto';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
