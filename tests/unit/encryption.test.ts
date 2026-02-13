import { describe, it, expect } from 'vitest';
import {
  deriveKeyFromPassword,
  encryptAesGcm,
  decryptAesGcm,
  encryptMnemonic,
  decryptMnemonic,
  deriveHkdfKey,
  hmacSha256,
  secureRandom,
} from '../../src/security/encryption.js';

describe('encryption', () => {
  describe('deriveKeyFromPassword', () => {
    it('should derive a 32-byte key', async () => {
      const { key, kdfParams } = await deriveKeyFromPassword('test-password');
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
      expect(kdfParams.algorithm).toBe('argon2id');
      expect(kdfParams.salt).toBeTruthy();
    });

    it('should produce same key with same salt', async () => {
      const salt = secureRandom(32);
      const { key: key1 } = await deriveKeyFromPassword('same-password', salt);
      const { key: key2 } = await deriveKeyFromPassword('same-password', Buffer.from(salt));
      expect(key1.toString('hex')).toBe(key2.toString('hex'));
    });

    it('should produce different keys with different passwords', async () => {
      const salt = secureRandom(32);
      const { key: key1 } = await deriveKeyFromPassword('password1', salt);
      const { key: key2 } = await deriveKeyFromPassword('password2', Buffer.from(salt));
      expect(key1.toString('hex')).not.toBe(key2.toString('hex'));
    });
  });

  describe('AES-256-GCM', () => {
    it('should encrypt and decrypt data', () => {
      const key = secureRandom(32);
      const plaintext = Buffer.from('Hello, World!');
      const cipher = encryptAesGcm(plaintext, key);
      const decrypted = decryptAesGcm(cipher, key);
      expect(decrypted.toString()).toBe('Hello, World!');
    });

    it('should fail with wrong key', () => {
      const key1 = secureRandom(32);
      const key2 = secureRandom(32);
      const plaintext = Buffer.from('secret data');
      const cipher = encryptAesGcm(plaintext, key1);
      expect(() => decryptAesGcm(cipher, key2)).toThrow();
    });

    it('should fail with tampered ciphertext', () => {
      const key = secureRandom(32);
      const plaintext = Buffer.from('secret data');
      const cipher = encryptAesGcm(plaintext, key);
      // Tamper with ciphertext — flip the first hex char to guarantee a change
      const firstChar = cipher.ciphertext[0];
      const flipped = firstChar === 'a' ? 'b' : 'a';
      const tampered = { ...cipher, ciphertext: flipped + cipher.ciphertext.slice(1) };
      expect(() => decryptAesGcm(tampered, key)).toThrow();
    });
  });

  describe('encryptMnemonic / decryptMnemonic', () => {
    it('should roundtrip mnemonic encryption', async () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const password = 'strong-password-123';

      const { kdfParams, cipherParams } = await encryptMnemonic(mnemonic, password);
      const decrypted = await decryptMnemonic(kdfParams, cipherParams, password);
      expect(decrypted).toBe(mnemonic);
    });

    it('should fail with wrong password', async () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const { kdfParams, cipherParams } = await encryptMnemonic(mnemonic, 'correct');
      await expect(decryptMnemonic(kdfParams, cipherParams, 'wrong')).rejects.toThrow();
    });
  });

  describe('HKDF', () => {
    it('should derive consistent keys', () => {
      const ikm = secureRandom(32);
      const salt = secureRandom(32);
      const key1 = deriveHkdfKey(ikm, salt, 'test-info');
      const key2 = deriveHkdfKey(Buffer.from(ikm), Buffer.from(salt), 'test-info');
      expect(key1.toString('hex')).toBe(key2.toString('hex'));
    });

    it('should derive different keys for different info', () => {
      const ikm = secureRandom(32);
      const salt = secureRandom(32);
      const key1 = deriveHkdfKey(ikm, salt, 'info-1');
      const key2 = deriveHkdfKey(Buffer.from(ikm), Buffer.from(salt), 'info-2');
      expect(key1.toString('hex')).not.toBe(key2.toString('hex'));
    });
  });

  describe('HMAC', () => {
    it('should produce consistent output', () => {
      const key = Buffer.from('key');
      const data = Buffer.from('data');
      const h1 = hmacSha256(key, data);
      const h2 = hmacSha256(key, data);
      expect(h1.toString('hex')).toBe(h2.toString('hex'));
    });
  });

  describe('secureRandom', () => {
    it('should generate unique random bytes', () => {
      const a = secureRandom(32);
      const b = secureRandom(32);
      expect(a.toString('hex')).not.toBe(b.toString('hex'));
    });
  });
});
