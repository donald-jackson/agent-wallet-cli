import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createKeystore } from '../../src/core/keystore.js';
import { createSession, validateSession, revokeSession, resolveToken } from '../../src/core/session.js';
import { WalletError } from '../../src/output/errors.js';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const TEST_PASSWORD = 'test-password-123';

describe('session', () => {
  let walletDir: string;

  beforeEach(async () => {
    walletDir = await mkdtemp(join(tmpdir(), 'wallet-cli-session-'));
    await createKeystore(walletDir, 'default', TEST_MNEMONIC, TEST_PASSWORD);
  });

  afterEach(async () => {
    await rm(walletDir, { recursive: true, force: true });
  });

  describe('createSession', () => {
    it('should create a session token', async () => {
      const token = await createSession(walletDir, 'default', TEST_MNEMONIC);
      expect(token).toMatch(/^wlt_/);
      expect(token.length).toBeGreaterThan(10);
    });
  });

  describe('validateSession', () => {
    it('should validate and decrypt mnemonic from session', async () => {
      const token = await createSession(walletDir, 'default', TEST_MNEMONIC);
      const mnemonic = await validateSession(walletDir, 'default', token);
      expect(mnemonic).toBe(TEST_MNEMONIC);
    });

    it('should reject invalid token', async () => {
      await createSession(walletDir, 'default', TEST_MNEMONIC);
      await expect(validateSession(walletDir, 'default', 'wlt_invalid')).rejects.toThrow();
    });

    it('should reject after revocation', async () => {
      const token = await createSession(walletDir, 'default', TEST_MNEMONIC);
      await revokeSession(walletDir, 'default');
      await expect(validateSession(walletDir, 'default', token)).rejects.toThrow(WalletError);
    });

    it('should reject expired sessions', async () => {
      const token = await createSession(walletDir, 'default', TEST_MNEMONIC, 0);
      // Wait a tick for expiry
      await new Promise((r) => setTimeout(r, 50));
      await expect(validateSession(walletDir, 'default', token)).rejects.toThrow(WalletError);
    });
  });

  describe('revokeSession', () => {
    it('should not throw for non-existent session', async () => {
      await expect(revokeSession(walletDir, 'nonexistent')).resolves.not.toThrow();
    });
  });

  describe('resolveToken', () => {
    it('should prefer explicit token', async () => {
      const token = await resolveToken(walletDir, 'default', 'wlt_explicit');
      expect(token).toBe('wlt_explicit');
    });

    it('should read from session file', async () => {
      const created = await createSession(walletDir, 'default', TEST_MNEMONIC);
      const resolved = await resolveToken(walletDir, 'default');
      expect(resolved).toBe(created);
    });

    it('should throw when no token available', async () => {
      await expect(resolveToken(walletDir, 'nofile')).rejects.toThrow(WalletError);
    });
  });
});
