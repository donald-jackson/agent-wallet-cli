import { describe, it, expect } from 'vitest';
import {
  DEFAULT_NETWORKS,
  WELL_KNOWN_TOKENS,
  getDefaultWalletDir,
  getKeystoreDir,
  getSessionDir,
  resolveTokenAddress,
  type AppConfig,
} from '../../src/core/config.js';

describe('config', () => {
  describe('DEFAULT_NETWORKS', () => {
    it('should have ethereum and solana chains', () => {
      expect(DEFAULT_NETWORKS).toHaveProperty('ethereum');
      expect(DEFAULT_NETWORKS).toHaveProperty('solana');
    });

    it('should have mainnet for each chain', () => {
      expect(DEFAULT_NETWORKS.ethereum).toHaveProperty('mainnet');
      expect(DEFAULT_NETWORKS.solana).toHaveProperty('mainnet');
    });

    it('should have rpcUrl for each network', () => {
      for (const chain of Object.values(DEFAULT_NETWORKS)) {
        for (const network of Object.values(chain)) {
          expect(network.rpcUrl).toBeTruthy();
        }
      }
    });
  });

  describe('getDefaultWalletDir', () => {
    it('should return a path ending with .wallet-cli', () => {
      const dir = getDefaultWalletDir();
      expect(dir).toMatch(/\.wallet-cli$/);
    });
  });

  describe('getKeystoreDir', () => {
    it('should return walletDir/keystores', () => {
      expect(getKeystoreDir('/tmp/wallet')).toBe('/tmp/wallet/keystores');
    });
  });

  describe('getSessionDir', () => {
    it('should return walletDir/sessions', () => {
      expect(getSessionDir('/tmp/wallet')).toBe('/tmp/wallet/sessions');
    });
  });

  describe('resolveTokenAddress', () => {
    const config: AppConfig = {
      walletDir: '/tmp',
      networks: DEFAULT_NETWORKS,
      tokens: WELL_KNOWN_TOKENS,
    };

    it('should resolve well-known token alias', () => {
      const result = resolveTokenAddress(config, 'ethereum', 'mainnet', 'usdc');
      expect(result.address).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      expect(result.decimals).toBe(6);
      expect(result.symbol).toBe('USDC');
    });

    it('should be case-insensitive for aliases', () => {
      const result = resolveTokenAddress(config, 'ethereum', 'mainnet', 'USDC');
      expect(result.address).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    });

    it('should return raw address for unknown aliases', () => {
      const result = resolveTokenAddress(config, 'ethereum', 'mainnet', '0xCustomAddr');
      expect(result.address).toBe('0xCustomAddr');
    });
  });
});
