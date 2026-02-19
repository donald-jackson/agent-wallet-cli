import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isRelaySupportedChain,
  getRelayQuote,
  submitRelay,
  pollRelayStatus,
  RELAY_API_BASE_URL,
  RELAY_SUPPORTED_CHAIN_IDS,
} from '../../src/relay/client.js';

describe('relay/client', () => {
  describe('constants', () => {
    it('should export the relay API base URL', () => {
      expect(RELAY_API_BASE_URL).toBe('https://relay.ai.bvnk.io');
    });

    it('should export supported chain IDs', () => {
      expect(RELAY_SUPPORTED_CHAIN_IDS).toContain(1);
      expect(RELAY_SUPPORTED_CHAIN_IDS).toContain(8453);
      expect(RELAY_SUPPORTED_CHAIN_IDS).toContain(11155111);
      expect(RELAY_SUPPORTED_CHAIN_IDS).toContain(84532);
    });
  });

  describe('isRelaySupportedChain', () => {
    it('should return true for Ethereum mainnet', () => {
      expect(isRelaySupportedChain(1)).toBe(true);
    });

    it('should return true for Base', () => {
      expect(isRelaySupportedChain(8453)).toBe(true);
    });

    it('should return true for Sepolia', () => {
      expect(isRelaySupportedChain(11155111)).toBe(true);
    });

    it('should return true for Base Sepolia', () => {
      expect(isRelaySupportedChain(84532)).toBe(true);
    });

    it('should return false for Polygon', () => {
      expect(isRelaySupportedChain(137)).toBe(false);
    });

    it('should return false for Arbitrum', () => {
      expect(isRelaySupportedChain(42161)).toBe(false);
    });

    it('should return false for unknown chain IDs', () => {
      expect(isRelaySupportedChain(999)).toBe(false);
    });
  });

  describe('getRelayQuote', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('should call the /relay/quote endpoint and return the result', async () => {
      const mockQuote = {
        chainId: 84532,
        token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        fee: '10000',
        totalRequired: '510000',
        gasEstimate: '150000',
        gasPriceGwei: '0.005',
        nativeTokenPriceUsd: '2500.00',
        expiresAt: '2026-02-17T12:05:00.000Z',
        relayContract: '0xRelayContractAddress',
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockQuote,
      } as Response);

      const result = await getRelayQuote({
        chainId: 84532,
        token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        amount: '500000',
        sender: '0xSender',
        recipient: '0xRecipient',
      });

      expect(result).toEqual(mockQuote);
      expect(fetch).toHaveBeenCalledWith(
        `${RELAY_API_BASE_URL}/relay/quote`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    it('should throw ERR_RELAY_FAILED on non-OK response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      } as Response);

      await expect(
        getRelayQuote({
          chainId: 8453,
          token: '0xToken',
          amount: '1000',
          sender: '0xSender',
          recipient: '0xRecipient',
        }),
      ).rejects.toThrow('Relay quote failed');
    });
  });

  describe('submitRelay', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('should call the /relay/submit endpoint and return requestId', async () => {
      const mockResult = { requestId: 'req_123', status: 'queued', estimatedWaitSeconds: 15 };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      } as Response);

      const result = await submitRelay({
        chainId: 84532,
        token: '0xToken',
        from: '0xFrom',
        to: '0xTo',
        amount: '500000',
        fee: '10000',
        validAfter: 0,
        validBefore: 1700001800,
        nonce: '0xabc123',
        v: 27,
        r: '0xr',
        s: '0xs',
      });

      expect(result.requestId).toBe('req_123');
      expect(fetch).toHaveBeenCalledWith(
        `${RELAY_API_BASE_URL}/relay/submit`,
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should throw ERR_RELAY_FAILED on non-OK response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as Response);

      await expect(
        submitRelay({
          chainId: 8453,
          token: '0xToken',
          from: '0xFrom',
          to: '0xTo',
          amount: '1000',
          fee: '10',
          validAfter: 0,
          validBefore: 1700001800,
          nonce: '0xabc123',
          v: 27,
          r: '0xr',
          s: '0xs',
        }),
      ).rejects.toThrow('Relay submission failed');
    });
  });

  describe('pollRelayStatus', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('should return confirmed status with txHash', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ requestId: 'req_123', status: 'confirmed', txHash: '0xabc123' }),
      } as Response);

      const result = await pollRelayStatus('req_123', RELAY_API_BASE_URL, 10000);
      expect(result.status).toBe('confirmed');
      expect(result.txHash).toBe('0xabc123');
      expect(fetch).toHaveBeenCalledWith(
        `${RELAY_API_BASE_URL}/relay/status/req_123`,
      );
    });

    it('should throw on failed status', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ requestId: 'req_123', status: 'failed', error: 'permit expired' }),
      } as Response);

      await expect(
        pollRelayStatus('req_123', RELAY_API_BASE_URL, 10000),
      ).rejects.toThrow('Relay transaction failed on-chain: permit expired');
    });

    it('should poll multiple times until confirmed', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ requestId: 'req_456', status: 'queued' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ requestId: 'req_456', status: 'submitted' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ requestId: 'req_456', status: 'confirmed', txHash: '0xdef456' }),
        } as Response);

      const result = await pollRelayStatus('req_456', RELAY_API_BASE_URL, 30000);
      expect(result.status).toBe('confirmed');
      expect(result.txHash).toBe('0xdef456');
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
  });
});
