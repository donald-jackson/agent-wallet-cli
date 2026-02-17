import {
  createPublicClient,
  http,
  type Address,
  type Hex,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { mainnet, sepolia, base, baseSepolia, type Chain } from 'viem/chains';
import { WalletError, ErrorCodes } from '../output/errors.js';

const PERMIT_CHAIN_MAP: Record<number, Chain> = {
  1: mainnet,
  11155111: sepolia,
  8453: base,
  84532: baseSepolia,
};

export interface PermitSignature {
  v: number;
  r: string;
  s: string;
  deadline: number;
}

const EIP2612_NAME_ABI = [
  { type: 'function', name: 'name', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
] as const;

const EIP2612_VERSION_ABI = [
  { type: 'function', name: 'version', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
] as const;

const EIP2612_NONCES_ABI = [
  { type: 'function', name: 'nonces', inputs: [{ type: 'address', name: 'owner' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const;

export async function signPermit(params: {
  mnemonic: string;
  accountIndex: number;
  rpcUrl: string;
  chainId: number;
  tokenAddress: string;
  spender: string;
  value: bigint;
}): Promise<PermitSignature> {
  const { mnemonic, accountIndex, rpcUrl, chainId, tokenAddress, spender, value } = params;

  const chain = PERMIT_CHAIN_MAP[chainId];
  if (!chain) {
    throw new WalletError(ErrorCodes.ERR_PERMIT_FAILED, `Chain ${chainId} not supported for permit signing`);
  }

  const account = mnemonicToAccount(mnemonic, { addressIndex: accountIndex });
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const token = tokenAddress as Address;

  // Read token name, version, and nonce in parallel
  let tokenName: string;
  let tokenVersion: string;
  let nonce: bigint;

  try {
    const [nameResult, nonceResult] = await Promise.all([
      client.readContract({ address: token, abi: EIP2612_NAME_ABI, functionName: 'name' }),
      client.readContract({ address: token, abi: EIP2612_NONCES_ABI, functionName: 'nonces', args: [account.address] }),
    ]);
    tokenName = nameResult;
    nonce = nonceResult;
  } catch (err) {
    throw new WalletError(
      ErrorCodes.ERR_PERMIT_FAILED,
      `Token does not support EIP-2612 permit: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Version is optional; default to "1" if not available
  try {
    tokenVersion = await client.readContract({ address: token, abi: EIP2612_VERSION_ABI, functionName: 'version' });
  } catch {
    tokenVersion = '1';
  }

  // Deadline: 30 minutes from now
  const deadline = Math.floor(Date.now() / 1000) + 30 * 60;

  const domain = {
    name: tokenName,
    version: tokenVersion,
    chainId,
    verifyingContract: token,
  };

  const types = {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  } as const;

  const message = {
    owner: account.address,
    spender: spender as Address,
    value,
    nonce,
    deadline: BigInt(deadline),
  };

  let signature: Hex;
  try {
    signature = await account.signTypedData({
      domain,
      types,
      primaryType: 'Permit',
      message,
    });
  } catch (err) {
    throw new WalletError(
      ErrorCodes.ERR_PERMIT_FAILED,
      `Failed to sign permit: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Parse v, r, s from signature
  const r = `0x${signature.slice(2, 66)}`;
  const s = `0x${signature.slice(66, 130)}`;
  const v = parseInt(signature.slice(130, 132), 16);

  return { v, r, s, deadline };
}
