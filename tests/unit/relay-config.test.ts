import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DEFAULT_RELAY_API_BASE_URL,
  type AppConfig,
  type RelayConfig,
} from '../../src/core/config.js';

describe('relay config', () => {
  describe('DEFAULT_RELAY_API_BASE_URL', () => {
    it('should export the default relay API URL', () => {
      expect(DEFAULT_RELAY_API_BASE_URL).toBe('https://7uz3zfgmc1.execute-api.us-east-1.amazonaws.com');
    });
  });

  describe('AppConfig relay field', () => {
    it('should include relay config in AppConfig type', () => {
      const config: AppConfig = {
        walletDir: '/tmp',
        networks: {},
        tokens: {},
        relay: {
          enabled: true,
          apiBaseUrl: DEFAULT_RELAY_API_BASE_URL,
        },
      };

      expect(config.relay.enabled).toBe(true);
      expect(config.relay.apiBaseUrl).toBe(DEFAULT_RELAY_API_BASE_URL);
    });

    it('should allow relay to be disabled', () => {
      const relay: RelayConfig = {
        enabled: false,
        apiBaseUrl: DEFAULT_RELAY_API_BASE_URL,
      };

      expect(relay.enabled).toBe(false);
    });

    it('should allow custom API URL', () => {
      const relay: RelayConfig = {
        enabled: true,
        apiBaseUrl: 'https://custom-relay.example.com',
      };

      expect(relay.apiBaseUrl).toBe('https://custom-relay.example.com');
    });
  });
});
