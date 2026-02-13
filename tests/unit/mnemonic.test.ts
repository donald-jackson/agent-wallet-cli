import { describe, it, expect } from 'vitest';
import {
  generateMnemonic,
  validateMnemonic,
  deriveEthereumAddress,
  deriveSolanaAddress,
  deriveAddresses,
} from '../../src/core/mnemonic.js';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('mnemonic', () => {
  describe('generateMnemonic', () => {
    it('should generate a 12-word mnemonic by default', () => {
      const mnemonic = generateMnemonic();
      expect(mnemonic.split(' ').length).toBe(12);
      expect(validateMnemonic(mnemonic)).toBe(true);
    });

    it('should generate a 24-word mnemonic', () => {
      const mnemonic = generateMnemonic(24);
      expect(mnemonic.split(' ').length).toBe(24);
      expect(validateMnemonic(mnemonic)).toBe(true);
    });
  });

  describe('validateMnemonic', () => {
    it('should validate a correct mnemonic', () => {
      expect(validateMnemonic(TEST_MNEMONIC)).toBe(true);
    });

    it('should reject an invalid mnemonic', () => {
      expect(validateMnemonic('invalid mnemonic phrase')).toBe(false);
    });
  });

  describe('deriveEthereumAddress', () => {
    it('should derive a valid Ethereum address', () => {
      const { address } = deriveEthereumAddress(TEST_MNEMONIC, 0);
      expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    it('should derive different addresses for different indices', () => {
      const { address: addr0 } = deriveEthereumAddress(TEST_MNEMONIC, 0);
      const { address: addr1 } = deriveEthereumAddress(TEST_MNEMONIC, 1);
      expect(addr0).not.toBe(addr1);
    });

    it('should be deterministic', () => {
      const { address: a1 } = deriveEthereumAddress(TEST_MNEMONIC, 0);
      const { address: a2 } = deriveEthereumAddress(TEST_MNEMONIC, 0);
      expect(a1).toBe(a2);
    });
  });

  describe('deriveSolanaAddress', () => {
    it('should derive a valid Solana address', () => {
      const { address } = deriveSolanaAddress(TEST_MNEMONIC, 0);
      // Solana addresses are base58, typically 32-44 chars
      expect(address.length).toBeGreaterThan(30);
      expect(address.length).toBeLessThan(50);
    });

    it('should derive different addresses for different indices', () => {
      const { address: addr0 } = deriveSolanaAddress(TEST_MNEMONIC, 0);
      const { address: addr1 } = deriveSolanaAddress(TEST_MNEMONIC, 1);
      expect(addr0).not.toBe(addr1);
    });

    it('should be deterministic', () => {
      const { address: a1 } = deriveSolanaAddress(TEST_MNEMONIC, 0);
      const { address: a2 } = deriveSolanaAddress(TEST_MNEMONIC, 0);
      expect(a1).toBe(a2);
    });
  });

  describe('deriveAddresses', () => {
    it('should derive both ethereum and solana addresses', () => {
      const addrs = deriveAddresses(TEST_MNEMONIC, 0);
      expect(addrs.ethereum).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(addrs.solana.length).toBeGreaterThan(30);
    });
  });
});
