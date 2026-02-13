import { describe, it, expect } from 'vitest';
import { clearBuffer, clearUint8Array, withSecretBuffer, withSecret } from '../../src/security/memory.js';

describe('memory security', () => {
  describe('clearBuffer', () => {
    it('should zero-fill a buffer', () => {
      const buf = Buffer.from('secret data');
      clearBuffer(buf);
      expect(buf.every((b) => b === 0)).toBe(true);
    });
  });

  describe('clearUint8Array', () => {
    it('should zero-fill a Uint8Array', () => {
      const arr = new Uint8Array([1, 2, 3, 4, 5]);
      clearUint8Array(arr);
      expect(arr.every((b) => b === 0)).toBe(true);
    });
  });

  describe('withSecretBuffer', () => {
    it('should clear buffer after use', async () => {
      const buf = Buffer.from('secret');
      await withSecretBuffer(buf, (s) => {
        expect(s.toString()).toBe('secret');
      });
      expect(buf.every((b) => b === 0)).toBe(true);
    });

    it('should clear buffer on error', async () => {
      const buf = Buffer.from('secret');
      await expect(
        withSecretBuffer(buf, () => {
          throw new Error('fail');
        }),
      ).rejects.toThrow('fail');
      expect(buf.every((b) => b === 0)).toBe(true);
    });
  });

  describe('withSecret', () => {
    it('should convert string to buffer and clear after use', async () => {
      let capturedBuf: Buffer | null = null;
      await withSecret('my-secret', (buf) => {
        capturedBuf = buf;
        expect(buf.toString()).toBe('my-secret');
      });
      expect(capturedBuf!.every((b: number) => b === 0)).toBe(true);
    });
  });
});
