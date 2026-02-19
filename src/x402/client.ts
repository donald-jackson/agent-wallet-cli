import {
  createPublicClient,
  http,
  type Address,
  type Hex,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { mainnet, sepolia, base, baseSepolia, polygon, arbitrum, type Chain } from 'viem/chains';
import { WalletError, ErrorCodes } from '../output/errors.js';
import type { AppConfig } from '../core/config.js';
import {
  CAIP2_CHAIN_ID_MAP,
  type PaymentRequired,
  type PaymentRequirementsV2,
  type EIP3009Payload,
  type PaymentPayload,
  type SettlementResponse,
} from './types.js';

const CHAIN_MAP: Record<number, Chain> = {
  1: mainnet,
  11155111: sepolia,
  8453: base,
  84532: baseSepolia,
  137: polygon,
  42161: arbitrum,
};

const ERC20_NAME_ABI = [
  { type: 'function', name: 'name', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
] as const;

const ERC20_VERSION_ABI = [
  { type: 'function', name: 'version', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
] as const;

/**
 * Parse a 402 Payment Required response.
 * Checks both `payment-required` and `x-payment-requirements` headers (base64 JSON).
 * Falls back to parsing the response body for V1.
 */
export async function parsePaymentRequired(response: Response): Promise<PaymentRequired> {
  // Try header-based formats: servers use either name
  const headerValue = response.headers.get('payment-required')
    ?? response.headers.get('x-payment-requirements');

  if (headerValue) {
    try {
      const decoded = Buffer.from(headerValue, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded);

      // Header may contain the full V2 object {x402Version, accepts, resource, ...}
      // or just the accepts array directly
      if (parsed.accepts && Array.isArray(parsed.accepts)) {
        return {
          x402Version: parsed.x402Version ?? 2,
          accepts: parsed.accepts,
          ...(parsed.resource ? { resource: parsed.resource } : {}),
        } as PaymentRequired;
      }

      // Bare array of payment options
      if (Array.isArray(parsed)) {
        return { x402Version: 2, accepts: parsed };
      }

      throw new Error('No accepts array found in header payload');
    } catch (err) {
      if (err instanceof WalletError) throw err;
      throw new WalletError(
        ErrorCodes.ERR_X402_INVALID_RESPONSE,
        `Failed to parse payment-required header: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Fallback: parse response body (V1 or V2)
  try {
    const body = await response.json() as Record<string, unknown>;
    if (body.accepts && Array.isArray(body.accepts)) {
      return {
        x402Version: (body.x402Version as number) ?? 1,
        accepts: body.accepts as PaymentRequirementsV2[],
        ...(body.resource ? { resource: body.resource } : {}),
      } as PaymentRequired;
    }
    throw new Error('Missing accepts array');
  } catch (err) {
    if (err instanceof WalletError) throw err;
    throw new WalletError(
      ErrorCodes.ERR_X402_INVALID_RESPONSE,
      `Failed to parse 402 response: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Select a compatible EVM payment option from the 402 response.
 * Filters for scheme "exact" and a supported EVM network.
 */
export function selectPaymentOption(paymentRequired: PaymentRequired): PaymentRequirementsV2 {
  for (const option of paymentRequired.accepts) {
    if (option.scheme !== 'exact') continue;
    const chainId = CAIP2_CHAIN_ID_MAP[option.network];
    if (chainId !== undefined && CHAIN_MAP[chainId]) {
      return option;
    }
  }

  throw new WalletError(
    ErrorCodes.ERR_X402_NO_COMPATIBLE_OPTION,
    `No compatible EVM payment option found. Available: ${paymentRequired.accepts.map(a => `${a.scheme}@${a.network}`).join(', ')}`,
  );
}

/**
 * Sign an EIP-3009 TransferWithAuthorization.
 * Mirrors the pattern from authorization.ts for EIP-712 typed data signing.
 */
export async function signTransferWithAuthorization(params: {
  mnemonic: string;
  accountIndex: number;
  rpcUrl: string;
  chainId: number;
  tokenAddress: Address;
  payTo: Address;
  value: bigint;
  validAfter?: bigint;
  validBefore?: bigint;
  extraName?: string;
  extraVersion?: string;
}): Promise<EIP3009Payload> {
  const {
    mnemonic, accountIndex, rpcUrl, chainId, tokenAddress, payTo, value,
    validAfter = 0n,
    extraName, extraVersion,
  } = params;

  const chain = CHAIN_MAP[chainId];
  if (!chain) {
    throw new WalletError(ErrorCodes.ERR_X402_UNSUPPORTED_NETWORK, `Chain ${chainId} not supported for x402 signing`);
  }

  const account = mnemonicToAccount(mnemonic, { addressIndex: accountIndex });
  const client = createPublicClient({ chain, transport: http(rpcUrl) });

  // Read token name from chain (or use extra.name)
  let tokenName: string;
  if (extraName) {
    tokenName = extraName;
  } else {
    try {
      tokenName = await client.readContract({ address: tokenAddress, abi: ERC20_NAME_ABI, functionName: 'name' });
    } catch (err) {
      throw new WalletError(
        ErrorCodes.ERR_X402_SIGNING_FAILED,
        `Failed to read token name: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Read token version from chain (or use extra.version, default "1")
  let tokenVersion: string;
  if (extraVersion) {
    tokenVersion = extraVersion;
  } else {
    try {
      tokenVersion = await client.readContract({ address: tokenAddress, abi: ERC20_VERSION_ABI, functionName: 'version' });
    } catch {
      tokenVersion = '1';
    }
  }

  // EIP-3009 uses random 32-byte nonces (not sequential)
  const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = ('0x' + Buffer.from(nonceBytes).toString('hex')) as Hex;

  // validBefore: use provided value or default to 30 minutes from now
  const actualValidBefore = params.validBefore ?? BigInt(Math.floor(Date.now() / 1000) + 30 * 60);

  const domain = {
    name: tokenName,
    version: tokenVersion,
    chainId,
    verifyingContract: tokenAddress,
  };

  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  } as const;

  const message = {
    from: account.address,
    to: payTo,
    value,
    validAfter,
    validBefore: actualValidBefore,
    nonce,
  };

  let signature: Hex;
  try {
    signature = await account.signTypedData({
      domain,
      types,
      primaryType: 'TransferWithAuthorization',
      message,
    });
  } catch (err) {
    throw new WalletError(
      ErrorCodes.ERR_X402_SIGNING_FAILED,
      `Failed to sign TransferWithAuthorization: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    signature,
    authorization: {
      from: account.address,
      to: payTo,
      value: value.toString(),
      validAfter: validAfter.toString(),
      validBefore: actualValidBefore.toString(),
      nonce,
    },
  };
}

/**
 * Build the payment header name and base64-encoded value.
 * V2: PAYMENT-SIGNATURE, V1: X-PAYMENT
 */
export function buildPaymentHeader(payload: PaymentPayload): { name: string; value: string } {
  const value = Buffer.from(JSON.stringify(payload)).toString('base64');
  const name = payload.x402Version >= 2 ? 'PAYMENT-SIGNATURE' : 'X-PAYMENT';
  return { name, value };
}

/**
 * Parse the settlement response from response headers.
 * V2: PAYMENT-RESPONSE, V1: X-PAYMENT-RESPONSE
 */
export function parseSettlementResponse(response: Response): SettlementResponse | undefined {
  const headerValue = response.headers.get('payment-response')
    ?? response.headers.get('x-payment-response');
  if (!headerValue) return undefined;

  try {
    const decoded = Buffer.from(headerValue, 'base64').toString('utf-8');
    return JSON.parse(decoded) as SettlementResponse;
  } catch {
    return undefined;
  }
}

/**
 * Reverse-lookup: find the RPC URL for a given numeric chainId
 * by searching through config.networks.ethereum entries.
 */
export function findRpcUrlForChainId(config: AppConfig, chainId: number): { rpcUrl: string; networkName: string } {
  const ethereumNetworks = config.networks.ethereum;
  if (!ethereumNetworks) {
    throw new WalletError(ErrorCodes.ERR_X402_UNSUPPORTED_NETWORK, `No ethereum networks configured`);
  }

  for (const [networkName, netConfig] of Object.entries(ethereumNetworks)) {
    if (netConfig.chainId === chainId) {
      return { rpcUrl: netConfig.rpcUrl, networkName };
    }
  }

  throw new WalletError(
    ErrorCodes.ERR_X402_UNSUPPORTED_NETWORK,
    `No RPC URL configured for chainId ${chainId}. Configure it with "agent-wallet-cli networks set-rpc".`,
  );
}
