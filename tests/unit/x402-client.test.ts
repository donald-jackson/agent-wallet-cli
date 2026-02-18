import { describe, it, expect } from 'vitest';
import {
  parsePaymentRequired,
  selectPaymentOption,
  buildPaymentHeader,
  parseSettlementResponse,
  findRpcUrlForChainId,
} from '../../src/x402/client.js';
import {
  CAIP2_CHAIN_ID_MAP,
  getPaymentAmount,
  type PaymentRequired,
  type PaymentRequirementsV2,
  type PaymentPayload,
} from '../../src/x402/types.js';
import { DEFAULT_NETWORKS, type AppConfig } from '../../src/core/config.js';

// Real payload captured from https://x402stt.dtelecom.org/v1/session
const DTELECOM_HEADER_DECODED = {
  x402Version: 2,
  error: 'Payment required',
  resource: {
    url: 'https://x402stt.dtelecom.org/v1/session',
    description: 'Real-time speech-to-text: buy a session, connect via WebSocket, stream audio, receive transcriptions. $0.005/min, min 5 min.',
    mimeType: 'application/json',
  },
  accepts: [
    {
      scheme: 'exact',
      network: 'eip155:8453',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      amount: '25000',
      payTo: '0x47d3394c7234714E4B9e9b74827c12bE847F9DDA',
      maxTimeoutSeconds: 300,
      extra: { name: 'USD Coin', version: '2' },
    },
    {
      scheme: 'exact',
      network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: '25000',
      payTo: '8MPzJeXx1RipFmRADExptc3UK4EV3nhEFN6NRSx7o7jm',
      maxTimeoutSeconds: 300,
      extra: { feePayer: 'BENrLoUbndxoNMUS5JXApGMtNykLjFXXixMtpDwDR9SP' },
    },
  ],
};

const DTELECOM_HEADER_B64 = Buffer.from(JSON.stringify(DTELECOM_HEADER_DECODED)).toString('base64');

function makeConfig(): AppConfig {
  return {
    walletDir: '/tmp',
    networks: JSON.parse(JSON.stringify(DEFAULT_NETWORKS)),
    tokens: {},
    relay: { enabled: false, apiBaseUrl: '' },
  };
}

function mockResponse(opts: { status?: number; headers?: Record<string, string>; body?: unknown }): Response {
  const { status = 402, headers = {}, body } = opts;
  return new Response(body ? JSON.stringify(body) : '{}', {
    status,
    headers: new Headers(headers),
  });
}

describe('x402/client', () => {
  describe('parsePaymentRequired', () => {
    it('should parse V2 from payment-required header (real dTelecom payload)', async () => {
      const response = mockResponse({
        headers: { 'payment-required': DTELECOM_HEADER_B64 },
      });

      const result = await parsePaymentRequired(response);
      expect(result.x402Version).toBe(2);
      expect(result.accepts).toHaveLength(2);
      expect(result.accepts[0].scheme).toBe('exact');
      expect(result.accepts[0].network).toBe('eip155:8453');
      expect(result.accepts[0].amount).toBe('25000');
      expect(result.accepts[0].payTo).toBe('0x47d3394c7234714E4B9e9b74827c12bE847F9DDA');
      expect(result.accepts[0].extra?.name).toBe('USD Coin');
      expect(result.accepts[0].extra?.version).toBe('2');
    });

    it('should preserve resource info from V2 header', async () => {
      const response = mockResponse({
        headers: { 'payment-required': DTELECOM_HEADER_B64 },
      });

      const result = await parsePaymentRequired(response);
      expect((result as { resource?: { url: string } }).resource?.url).toBe('https://x402stt.dtelecom.org/v1/session');
    });

    it('should parse from x-payment-requirements header', async () => {
      const payload = { x402Version: 2, accepts: [DTELECOM_HEADER_DECODED.accepts[0]] };
      const b64 = Buffer.from(JSON.stringify(payload)).toString('base64');
      const response = mockResponse({
        headers: { 'x-payment-requirements': b64 },
      });

      const result = await parsePaymentRequired(response);
      expect(result.x402Version).toBe(2);
      expect(result.accepts).toHaveLength(1);
    });

    it('should parse bare array in header', async () => {
      const b64 = Buffer.from(JSON.stringify([DTELECOM_HEADER_DECODED.accepts[0]])).toString('base64');
      const response = mockResponse({
        headers: { 'payment-required': b64 },
      });

      const result = await parsePaymentRequired(response);
      expect(result.x402Version).toBe(2);
      expect(result.accepts).toHaveLength(1);
    });

    it('should fall back to V1 body parsing when no header present', async () => {
      const response = mockResponse({
        body: { x402Version: 1, accepts: [DTELECOM_HEADER_DECODED.accepts[0]] },
      });

      const result = await parsePaymentRequired(response);
      expect(result.x402Version).toBe(1);
      expect(result.accepts).toHaveLength(1);
    });

    it('should throw on invalid header', async () => {
      const response = mockResponse({
        headers: { 'payment-required': '!!!not-base64!!!' },
      });

      await expect(parsePaymentRequired(response)).rejects.toThrow('Failed to parse payment-required header');
    });

    it('should throw on body with no accepts', async () => {
      const response = mockResponse({ body: { foo: 'bar' } });

      await expect(parsePaymentRequired(response)).rejects.toThrow('Missing accepts array');
    });
  });

  describe('selectPaymentOption', () => {
    it('should select the Base EVM option from dTelecom payload', () => {
      const paymentRequired: PaymentRequired = {
        x402Version: 2,
        accepts: DTELECOM_HEADER_DECODED.accepts as unknown as PaymentRequirementsV2[],
      };

      const option = selectPaymentOption(paymentRequired);
      expect(option.network).toBe('eip155:8453');
      expect(option.asset).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    });

    it('should skip non-exact schemes', () => {
      const paymentRequired: PaymentRequired = {
        x402Version: 2,
        accepts: [
          { scheme: 'streaming', network: 'eip155:8453', amount: '100', payTo: '0x00', maxTimeoutSeconds: 60, asset: '0x00' },
          { scheme: 'exact', network: 'eip155:8453', amount: '100', payTo: '0x01', maxTimeoutSeconds: 60, asset: '0x01' },
        ] as unknown as PaymentRequirementsV2[],
      };

      const option = selectPaymentOption(paymentRequired);
      expect(option.payTo).toBe('0x01');
    });

    it('should skip unsupported networks', () => {
      const paymentRequired: PaymentRequired = {
        x402Version: 2,
        accepts: [
          { scheme: 'exact', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', amount: '100', payTo: '0x00', maxTimeoutSeconds: 60, asset: '0x00' },
        ] as unknown as PaymentRequirementsV2[],
      };

      expect(() => selectPaymentOption(paymentRequired)).toThrow('No compatible EVM payment option');
    });

    it('should throw when no options available', () => {
      const paymentRequired: PaymentRequired = { x402Version: 2, accepts: [] };
      expect(() => selectPaymentOption(paymentRequired)).toThrow('No compatible EVM payment option');
    });
  });

  describe('getPaymentAmount', () => {
    it('should return amount field when present', () => {
      const option = { amount: '25000' } as PaymentRequirementsV2;
      expect(getPaymentAmount(option)).toBe('25000');
    });

    it('should fall back to maxAmountRequired', () => {
      const option = { maxAmountRequired: '50000' } as PaymentRequirementsV2;
      expect(getPaymentAmount(option)).toBe('50000');
    });

    it('should prefer amount over maxAmountRequired', () => {
      const option = { amount: '25000', maxAmountRequired: '50000' } as PaymentRequirementsV2;
      expect(getPaymentAmount(option)).toBe('25000');
    });

    it('should throw when neither is present', () => {
      const option = { scheme: 'exact' } as PaymentRequirementsV2;
      expect(() => getPaymentAmount(option)).toThrow('no amount');
    });
  });

  describe('buildPaymentHeader', () => {
    const accepted = DTELECOM_HEADER_DECODED.accepts[0] as unknown as PaymentRequirementsV2;

    it('should produce valid base64 JSON with PAYMENT-SIGNATURE for V2', () => {
      const payload: PaymentPayload = {
        x402Version: 2,
        accepted,
        payload: {
          signature: '0xabc123',
          authorization: {
            from: '0x1111111111111111111111111111111111111111',
            to: '0x2222222222222222222222222222222222222222',
            value: '25000',
            validAfter: '0',
            validBefore: '1800000',
            nonce: '0x0000000000000000000000000000000000000000000000000000000000000001',
          },
        },
      };

      const { name, value } = buildPaymentHeader(payload);
      expect(name).toBe('PAYMENT-SIGNATURE');

      const decoded = JSON.parse(Buffer.from(value, 'base64').toString('utf-8'));
      expect(decoded.x402Version).toBe(2);
      expect(decoded.accepted.scheme).toBe('exact');
      expect(decoded.payload.signature).toBe('0xabc123');
    });

    it('should use X-PAYMENT header name for V1', () => {
      const payload: PaymentPayload = {
        x402Version: 1,
        accepted,
        payload: {
          signature: '0xdeadbeef',
          authorization: {
            from: '0x0000000000000000000000000000000000000000',
            to: '0x0000000000000000000000000000000000000001',
            value: '100',
            validAfter: '0',
            validBefore: '9999999999',
            nonce: '0x0000000000000000000000000000000000000000000000000000000000000042',
          },
        },
      };

      const { name, value } = buildPaymentHeader(payload);
      expect(name).toBe('X-PAYMENT');

      const decoded = JSON.parse(Buffer.from(value, 'base64').toString('utf-8'));
      expect(decoded).toEqual(payload);
    });
  });

  describe('parseSettlementResponse', () => {
    it('should parse valid payment-response header (V2)', () => {
      const settlement = { success: true, txHash: '0xabc', network: 'eip155:8453' };
      const b64 = Buffer.from(JSON.stringify(settlement)).toString('base64');
      const response = mockResponse({ status: 200, headers: { 'payment-response': b64 } });

      const result = parseSettlementResponse(response);
      expect(result).toEqual(settlement);
    });

    it('should parse valid x-payment-response header (V1)', () => {
      const settlement = { success: true, txHash: '0xdef', network: 'eip155:1' };
      const b64 = Buffer.from(JSON.stringify(settlement)).toString('base64');
      const response = mockResponse({ status: 200, headers: { 'x-payment-response': b64 } });

      const result = parseSettlementResponse(response);
      expect(result).toEqual(settlement);
    });

    it('should return undefined when header is missing', () => {
      const response = mockResponse({ status: 200 });
      expect(parseSettlementResponse(response)).toBeUndefined();
    });

    it('should return undefined on invalid base64', () => {
      const response = mockResponse({ status: 200, headers: { 'x-payment-response': '!!!invalid!!!' } });
      expect(parseSettlementResponse(response)).toBeUndefined();
    });
  });

  describe('findRpcUrlForChainId', () => {
    it('should find Base mainnet by chainId 8453', () => {
      const config = makeConfig();
      const result = findRpcUrlForChainId(config, 8453);
      expect(result.networkName).toBe('base');
      expect(result.rpcUrl).toBeTruthy();
    });

    it('should find Base Sepolia by chainId 84532', () => {
      const config = makeConfig();
      const result = findRpcUrlForChainId(config, 84532);
      expect(result.networkName).toBe('base-sepolia');
    });

    it('should find Ethereum mainnet by chainId 1', () => {
      const config = makeConfig();
      const result = findRpcUrlForChainId(config, 1);
      expect(result.networkName).toBe('mainnet');
    });

    it('should throw for unknown chainId', () => {
      const config = makeConfig();
      expect(() => findRpcUrlForChainId(config, 999999)).toThrow('No RPC URL configured for chainId 999999');
    });

    it('should throw when ethereum networks missing', () => {
      const config = makeConfig();
      delete config.networks.ethereum;
      expect(() => findRpcUrlForChainId(config, 8453)).toThrow('No ethereum networks configured');
    });
  });

  describe('CAIP2_CHAIN_ID_MAP', () => {
    it('should map all expected chains', () => {
      expect(CAIP2_CHAIN_ID_MAP['eip155:1']).toBe(1);
      expect(CAIP2_CHAIN_ID_MAP['eip155:8453']).toBe(8453);
      expect(CAIP2_CHAIN_ID_MAP['eip155:84532']).toBe(84532);
      expect(CAIP2_CHAIN_ID_MAP['eip155:137']).toBe(137);
      expect(CAIP2_CHAIN_ID_MAP['eip155:42161']).toBe(42161);
    });

    it('should not map Solana networks', () => {
      expect(CAIP2_CHAIN_ID_MAP['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp']).toBeUndefined();
    });
  });
});
