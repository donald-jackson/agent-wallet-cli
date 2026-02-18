import type { Address, Hex } from 'viem';

// CAIP-2 chain ID → numeric EVM chain ID
export const CAIP2_CHAIN_ID_MAP: Record<string, number> = {
  'eip155:1': 1,
  'eip155:11155111': 11155111,
  'eip155:137': 137,
  'eip155:42161': 42161,
  'eip155:8453': 8453,
  'eip155:84532': 84532,
};

// V2 payment requirements (individual payment option)
export interface PaymentRequirementsV2 {
  scheme: string;
  network: string; // CAIP-2, e.g. "eip155:8453"
  // Servers use either "amount" or "maxAmountRequired"
  amount?: string;
  maxAmountRequired?: string;
  payTo: Address;
  maxTimeoutSeconds: number;
  asset: Address;
  extra?: {
    name?: string;
    version?: string;
    [key: string]: unknown;
  };
}

// Resource info from V2 402 response
export interface PaymentResource {
  url: string;
  description?: string;
  mimeType?: string;
}

// V2 402 response (header-based)
export interface PaymentRequiredV2 {
  x402Version: 2;
  accepts: PaymentRequirementsV2[];
  resource?: PaymentResource;
  error?: string;
}

// V1 402 response (body-based)
export interface PaymentRequiredV1 {
  x402Version: 1;
  accepts: PaymentRequirementsV2[];
}

export type PaymentRequired = PaymentRequiredV1 | PaymentRequiredV2;

/**
 * Get the payment amount from a requirement, handling both field names.
 */
export function getPaymentAmount(option: PaymentRequirementsV2): string {
  const amount = option.amount ?? option.maxAmountRequired;
  if (!amount) throw new Error('Payment option has no amount or maxAmountRequired');
  return amount;
}

// EIP-3009 TransferWithAuthorization types
export interface EIP3009Authorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

export interface EIP3009Payload {
  signature: Hex;
  authorization: EIP3009Authorization;
}

// The PAYMENT-SIGNATURE / X-PAYMENT header payload
// V2 spec: { x402Version, resource, accepted, payload }
export interface PaymentPayload {
  x402Version: number;
  resource?: PaymentResource;
  accepted: PaymentRequirementsV2;
  payload: {
    signature: Hex;
    authorization: EIP3009Authorization;
  };
}

// Settlement response from the facilitator
// Servers use either "txHash" or "transaction" for the tx hash
export interface SettlementResponse {
  success: boolean;
  txHash?: string;
  transaction?: string;
  network?: string;
  payer?: string;
  error?: string;
}
