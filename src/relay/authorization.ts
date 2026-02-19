import {
  createPublicClient,
  http,
  type Address,
  type Hex,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { mainnet, sepolia, base, baseSepolia, type Chain } from 'viem/chains';
import { WalletError, ErrorCodes } from '../output/errors.js';

const AUTHORIZATION_CHAIN_MAP: Record<number, Chain> = {
  1: mainnet,
  11155111: sepolia,
  8453: base,
  84532: baseSepolia,
};

export interface AuthorizationSignature {
  v: number;
  r: string;
  s: string;
  validAfter: number;
  validBefore: number;
  nonce: `0x${string}`;
}

const ERC20_NAME_ABI = [
  { type: 'function', name: 'name', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
] as const;

export async function signAuthorization(params: {
  mnemonic: string;
  accountIndex: number;
  rpcUrl: string;
  chainId: number;
  tokenAddress: string;
  to: string;
  value: bigint;
}): Promise<AuthorizationSignature> {
  const { mnemonic, accountIndex, rpcUrl, chainId, tokenAddress, to, value } = params;

  const chain = AUTHORIZATION_CHAIN_MAP[chainId];
  if (!chain) {
    throw new WalletError(ErrorCodes.ERR_AUTHORIZATION_FAILED, `Chain ${chainId} not supported for authorization signing`);
  }

  const account = mnemonicToAccount(mnemonic, { addressIndex: accountIndex });
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const token = tokenAddress as Address;

  // Read token name from chain
  let tokenName: string;
  try {
    tokenName = await client.readContract({ address: token, abi: ERC20_NAME_ABI, functionName: 'name' });
  } catch (err) {
    throw new WalletError(
      ErrorCodes.ERR_AUTHORIZATION_FAILED,
      `Token does not support EIP-3009 authorization: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Version hardcoded to "2" for EIP-3009
  const tokenVersion = '2';

  // Generate random 32-byte nonce
  const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = ('0x' + Buffer.from(nonceBytes).toString('hex')) as `0x${string}`;

  // validAfter = 0 (immediately valid), validBefore = now + 30 minutes
  const validAfter = 0;
  const validBefore = Math.floor(Date.now() / 1000) + 30 * 60;

  const domain = {
    name: tokenName,
    version: tokenVersion,
    chainId,
    verifyingContract: token,
  };

  const types = {
    ReceiveWithAuthorization: [
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
    to: to as Address,
    value,
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
    nonce,
  };

  let signature: Hex;
  try {
    signature = await account.signTypedData({
      domain,
      types,
      primaryType: 'ReceiveWithAuthorization',
      message,
    });
  } catch (err) {
    throw new WalletError(
      ErrorCodes.ERR_AUTHORIZATION_FAILED,
      `Failed to sign authorization: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Parse v, r, s from signature
  const r = `0x${signature.slice(2, 66)}`;
  const s = `0x${signature.slice(66, 130)}`;
  const v = parseInt(signature.slice(130, 132), 16);

  return { v, r, s, validAfter, validBefore, nonce };
}
