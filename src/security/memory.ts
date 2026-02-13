/**
 * Secure memory clearing utilities.
 * Best-effort clearing — JS GC may copy buffers, but we minimize exposure window.
 */

/** Zero-fill a Buffer in place. */
export function clearBuffer(buf: Buffer): void {
  buf.fill(0);
}

/** Zero-fill a Uint8Array in place. */
export function clearUint8Array(arr: Uint8Array): void {
  arr.fill(0);
}

/**
 * Execute a function with a secret Buffer, ensuring the buffer is zeroed
 * after use regardless of success or failure.
 */
export async function withSecretBuffer<T>(
  secret: Buffer,
  fn: (secret: Buffer) => T | Promise<T>,
): Promise<T> {
  try {
    return await fn(secret);
  } finally {
    clearBuffer(secret);
  }
}

/**
 * Execute a function with a secret string converted to Buffer,
 * ensuring the buffer is zeroed after use.
 */
export async function withSecret<T>(
  secret: string,
  fn: (secret: Buffer) => T | Promise<T>,
): Promise<T> {
  const buf = Buffer.from(secret, 'utf-8');
  return withSecretBuffer(buf, fn);
}
