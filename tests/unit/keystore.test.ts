import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createKeystore, readKeystore, decryptKeystore, keystoreExists, listKeystores } from '../../src/core/keystore.js';
import { WalletError } from '../../src/output/errors.js';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const TEST_PASSWORD = 'test-password-123';

describe('keystore', () => {
  let walletDir: string;

  beforeEach(async () => {
    walletDir = await mkdtemp(join(tmpdir(), 'wallet-cli-test-'));
  });

  afterEach(async () => {
    await rm(walletDir, { recursive: true, force: true });
  });

  describe('createKeystore', () => {
    it('should create a keystore file', async () => {
      const keystore = await createKeystore(walletDir, 'test', TEST_MNEMONIC, TEST_PASSWORD);
      expect(keystore.version).toBe(1);
      expect(keystore.name).toBe('test');
      expect(keystore.addresses.ethereum.length).toBe(1);
      expect(keystore.addresses.solana.length).toBe(1);
      expect(keystore.addresses.ethereum[0]).toMatch(/^0x/);
    });

    it('should reject duplicate names', async () => {
      await createKeystore(walletDir, 'dupe', TEST_MNEMONIC, TEST_PASSWORD);
      await expect(createKeystore(walletDir, 'dupe', TEST_MNEMONIC, TEST_PASSWORD)).rejects.toThrow(WalletError);
    });
  });

  describe('readKeystore', () => {
    it('should read an existing keystore', async () => {
      await createKeystore(walletDir, 'readable', TEST_MNEMONIC, TEST_PASSWORD);
      const keystore = await readKeystore(walletDir, 'readable');
      expect(keystore.name).toBe('readable');
    });

    it('should throw for non-existent keystore', async () => {
      await expect(readKeystore(walletDir, 'nonexistent')).rejects.toThrow(WalletError);
    });
  });

  describe('decryptKeystore', () => {
    it('should decrypt with correct password', async () => {
      await createKeystore(walletDir, 'decrypt-test', TEST_MNEMONIC, TEST_PASSWORD);
      const mnemonic = await decryptKeystore(walletDir, 'decrypt-test', TEST_PASSWORD);
      expect(mnemonic).toBe(TEST_MNEMONIC);
    });

    it('should fail with wrong password', async () => {
      await createKeystore(walletDir, 'wrong-pw', TEST_MNEMONIC, TEST_PASSWORD);
      await expect(decryptKeystore(walletDir, 'wrong-pw', 'wrong')).rejects.toThrow();
    });
  });

  describe('keystoreExists', () => {
    it('should return true for existing keystore', async () => {
      await createKeystore(walletDir, 'exists', TEST_MNEMONIC, TEST_PASSWORD);
      expect(await keystoreExists(walletDir, 'exists')).toBe(true);
    });

    it('should return false for non-existent keystore', async () => {
      expect(await keystoreExists(walletDir, 'nope')).toBe(false);
    });
  });

  describe('listKeystores', () => {
    it('should list all keystores', async () => {
      await createKeystore(walletDir, 'alpha', TEST_MNEMONIC, TEST_PASSWORD);
      await createKeystore(walletDir, 'beta', TEST_MNEMONIC, 'other-pw');
      const list = await listKeystores(walletDir);
      expect(list).toContain('alpha');
      expect(list).toContain('beta');
      expect(list.length).toBe(2);
    });

    it('should return empty array for no keystores', async () => {
      const list = await listKeystores(walletDir);
      expect(list).toEqual([]);
    });
  });
});
