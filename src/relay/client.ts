import { WalletError, ErrorCodes } from '../output/errors.js';

export const RELAY_API_BASE_URL = 'https://7uz3zfgmc1.execute-api.us-east-1.amazonaws.com';
export const RELAY_CONTRACT_ADDRESS = '0xc0F92D26bBeBC242F14c1d984dBB51270c674ECe';
export const RELAY_SUPPORTED_CHAIN_IDS = [1, 8453, 11155111, 84532] as const;

export interface RelayQuote {
  chainId: number;
  token: string;
  fee: string;
  totalRequired: string;
  gasEstimate: string;
  gasPriceGwei: string;
  nativeTokenPriceUsd: string;
  expiresAt: string;
}

export interface RelaySubmitResult {
  requestId: string;
  status: string;
  estimatedWaitSeconds?: number;
}

export interface RelayStatus {
  requestId: string;
  status: 'queued' | 'pending' | 'submitted' | 'confirmed' | 'failed';
  chainId?: number;
  txHash?: string;
  fee?: string;
  error?: string | null;
}

export function isRelaySupportedChain(chainId: number): boolean {
  return (RELAY_SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
}

export async function getRelayQuote(
  params: {
    chainId: number;
    token: string;
    amount: string;
    sender: string;
    recipient: string;
  },
  apiBaseUrl = RELAY_API_BASE_URL,
): Promise<RelayQuote> {
  const url = `${apiBaseUrl}/relay/quote`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chainId: params.chainId,
      token: params.token,
      amount: params.amount,
      sender: params.sender,
      recipient: params.recipient,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new WalletError(
      ErrorCodes.ERR_RELAY_FAILED,
      `Relay quote failed (${response.status}): ${body}`,
    );
  }

  return (await response.json()) as RelayQuote;
}

export async function submitRelay(
  params: {
    chainId: number;
    token: string;
    from: string;
    to: string;
    amount: string;
    fee: string;
    deadline: number;
    v: number;
    r: string;
    s: string;
  },
  apiBaseUrl = RELAY_API_BASE_URL,
): Promise<RelaySubmitResult> {
  const url = `${apiBaseUrl}/relay/submit`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chainId: params.chainId,
      token: params.token,
      from: params.from,
      to: params.to,
      amount: params.amount,
      fee: params.fee,
      deadline: params.deadline,
      v: params.v,
      r: params.r,
      s: params.s,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new WalletError(
      ErrorCodes.ERR_RELAY_FAILED,
      `Relay submission failed (${response.status}): ${body}`,
    );
  }

  return (await response.json()) as RelaySubmitResult;
}

export async function pollRelayStatus(
  requestId: string,
  apiBaseUrl = RELAY_API_BASE_URL,
  maxWaitMs = 120_000,
): Promise<RelayStatus> {
  const pollInterval = 3_000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const url = `${apiBaseUrl}/relay/status/${encodeURIComponent(requestId)}`;
    const response = await fetch(url);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new WalletError(
        ErrorCodes.ERR_RELAY_FAILED,
        `Relay status check failed (${response.status}): ${body}`,
      );
    }

    const status = (await response.json()) as RelayStatus;

    if (status.status === 'confirmed' || status.status === 'failed') {
      if (status.status === 'failed') {
        throw new WalletError(
          ErrorCodes.ERR_RELAY_FAILED,
          `Relay transaction failed on-chain${status.error ? ': ' + status.error : ''}`,
        );
      }
      return status;
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new WalletError(
    ErrorCodes.ERR_RELAY_TIMEOUT,
    `Relay transaction not confirmed within ${maxWaitMs / 1000}s`,
  );
}
