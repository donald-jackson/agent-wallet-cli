import {
  createPublicClient,
  http,
  erc20Abi,
  formatUnits,
  parseUnits,
  type Address,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { mainnet, sepolia, base, baseSepolia, type Chain } from 'viem/chains';
import { WalletError, ErrorCodes } from '../output/errors.js';
import {
  getRelayQuote,
  submitRelay,
  pollRelayStatus,
  RELAY_CONTRACT_ADDRESS,
} from './client.js';
import { signPermit } from './permit.js';

const ORCHESTRATOR_CHAIN_MAP: Record<number, Chain> = {
  1: mainnet,
  11155111: sepolia,
  8453: base,
  84532: baseSepolia,
};

export interface GaslessTransferResult {
  txHash: string;
  requestId: string;
  fee: string;
  feeSymbol: string;
  amountReceived: string;
}

export async function attemptGaslessTransfer(params: {
  mnemonic: string;
  accountIndex: number;
  tokenAddress: string;
  to: string;
  amount: string;
  rpcUrl: string;
  chainId: number;
  apiBaseUrl?: string;
}): Promise<GaslessTransferResult> {
  const { mnemonic, accountIndex, tokenAddress, to, amount, rpcUrl, chainId, apiBaseUrl } = params;

  const chain = ORCHESTRATOR_CHAIN_MAP[chainId];
  if (!chain) {
    throw new WalletError(ErrorCodes.ERR_RELAY_UNSUPPORTED, `Chain ${chainId} not supported by relay`);
  }

  const account = mnemonicToAccount(mnemonic, { addressIndex: accountIndex });
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const token = tokenAddress as Address;

  // Get token info (decimals + symbol)
  const [decimals, symbol] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
    client.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
  ]);
  const tokenDecimals = Number(decimals);
  const tokenSymbol = symbol as string;

  const parsedAmount = parseUnits(amount, tokenDecimals);

  // 1. Get relay quote (fee and totalRequired are in raw token units)
  const quote = await getRelayQuote(
    {
      chainId,
      token: tokenAddress,
      amount: parsedAmount.toString(),
      sender: account.address,
      recipient: to,
    },
    apiBaseUrl,
  );

  // 2. Verify token balance >= totalRequired (amount + fee)
  const totalRequired = BigInt(quote.totalRequired);
  const feeRaw = BigInt(quote.fee);
  const balance = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  });

  if (balance < totalRequired) {
    throw new WalletError(
      ErrorCodes.ERR_INSUFFICIENT_BALANCE,
      `Insufficient token balance for relay: have ${formatUnits(balance, tokenDecimals)}, need ${formatUnits(totalRequired, tokenDecimals)} (${amount} + ${formatUnits(feeRaw, tokenDecimals)} fee)`,
    );
  }

  // 3. Sign EIP-2612 permit for totalRequired (amount + fee) to the relay contract
  const permitSig = await signPermit({
    mnemonic,
    accountIndex,
    rpcUrl,
    chainId,
    tokenAddress,
    spender: RELAY_CONTRACT_ADDRESS,
    value: totalRequired,
  });

  // 4. Submit to relay API
  const submitResult = await submitRelay(
    {
      chainId,
      token: tokenAddress,
      from: account.address,
      to,
      amount: parsedAmount.toString(),
      fee: quote.fee,
      deadline: permitSig.deadline,
      v: permitSig.v,
      r: permitSig.r,
      s: permitSig.s,
    },
    apiBaseUrl,
  );

  // 5. Poll for confirmation
  const status = await pollRelayStatus(submitResult.requestId, apiBaseUrl);

  return {
    txHash: status.txHash ?? '',
    requestId: submitResult.requestId,
    fee: formatUnits(feeRaw, tokenDecimals),
    feeSymbol: tokenSymbol,
    amountReceived: formatUnits(parsedAmount, tokenDecimals),
  };
}
