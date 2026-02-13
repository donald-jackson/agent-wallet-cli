import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  formatUnits,
  parseUnits,
  parseAbiItem,
  erc20Abi,
  type Address,
  type Hex,
  maxUint256,
  hashMessage,
  hashTypedData,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { mainnet, sepolia, polygon, arbitrum, base, baseSepolia, type Chain } from 'viem/chains';
import type {
  ChainAdapter,
  TransferResult,
  BalanceResult,
  AllowanceResult,
  SignMessageResult,
  SignTypedDataResult,
  TransactionHistoryEntry,
} from './types.js';
import { clearUint8Array } from '../security/memory.js';
import { WalletError, ErrorCodes } from '../output/errors.js';

const CHAIN_MAP: Record<number, Chain> = {
  1: mainnet,
  11155111: sepolia,
  137: polygon,
  42161: arbitrum,
  8453: base,
  84532: baseSepolia,
};

function getViemChain(chainId?: number): Chain {
  if (!chainId) return mainnet;
  return CHAIN_MAP[chainId] ?? mainnet;
}

function getAccount(mnemonic: string, accountIndex: number) {
  return mnemonicToAccount(mnemonic, { addressIndex: accountIndex });
}

function makePublicClient(rpcUrl: string, chainId?: number) {
  return createPublicClient({
    chain: getViemChain(chainId),
    transport: http(rpcUrl),
  });
}

function makeWalletClient(rpcUrl: string, mnemonic: string, accountIndex: number, chainId?: number) {
  const account = getAccount(mnemonic, accountIndex);
  return {
    client: createWalletClient({
      account,
      chain: getViemChain(chainId),
      transport: http(rpcUrl),
    }),
    account,
  };
}

async function getTokenInfo(rpcUrl: string, tokenAddress: Address, chainId?: number) {
  const client = makePublicClient(rpcUrl, chainId);
  const [decimals, symbol] = await Promise.all([
    client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'decimals' }),
    client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'symbol' }),
  ]);
  return { decimals: Number(decimals), symbol: symbol as string };
}

export class EthereumAdapter implements ChainAdapter {
  readonly chain = 'ethereum';
  private chainId?: number;

  constructor(chainId?: number) {
    this.chainId = chainId;
  }

  deriveAddress(mnemonic: string, accountIndex = 0): string {
    const account = getAccount(mnemonic, accountIndex);
    return account.address;
  }

  async getBalance(address: string, rpcUrl: string): Promise<BalanceResult> {
    const client = makePublicClient(rpcUrl, this.chainId);
    const balance = await client.getBalance({ address: address as Address });
    return {
      balance: formatEther(balance),
      balanceRaw: balance.toString(),
      symbol: 'ETH',
      decimals: 18,
    };
  }

  async getTokenBalance(address: string, tokenAddress: string, rpcUrl: string): Promise<BalanceResult> {
    const client = makePublicClient(rpcUrl, this.chainId);
    const [balance, info] = await Promise.all([
      client.readContract({
        address: tokenAddress as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address as Address],
      }),
      getTokenInfo(rpcUrl, tokenAddress as Address, this.chainId),
    ]);
    return {
      balance: formatUnits(balance, info.decimals),
      balanceRaw: balance.toString(),
      symbol: info.symbol,
      decimals: info.decimals,
    };
  }

  async transfer(
    mnemonic: string,
    accountIndex: number,
    to: string,
    amount: string,
    rpcUrl: string,
    dryRun = false,
  ): Promise<TransferResult> {
    const value = parseEther(amount);

    if (dryRun) {
      const account = getAccount(mnemonic, accountIndex);
      const client = makePublicClient(rpcUrl, this.chainId);
      await client.estimateGas({
        account: account.address,
        to: to as Address,
        value,
      });
      return { txHash: '0x0000000000000000000000000000000000000000000000000000000000000000 (dry-run)' };
    }

    const { client } = makeWalletClient(rpcUrl, mnemonic, accountIndex, this.chainId);
    const hash = await client.sendTransaction({
      to: to as Address,
      value,
    });
    return { txHash: hash };
  }

  async transferToken(
    mnemonic: string,
    accountIndex: number,
    tokenAddress: string,
    to: string,
    amount: string,
    rpcUrl: string,
    dryRun = false,
  ): Promise<TransferResult> {
    const info = await getTokenInfo(rpcUrl, tokenAddress as Address, this.chainId);
    const parsedAmount = parseUnits(amount, info.decimals);

    if (dryRun) {
      const account = getAccount(mnemonic, accountIndex);
      const client = makePublicClient(rpcUrl, this.chainId);
      await client.simulateContract({
        account: account.address,
        address: tokenAddress as Address,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [to as Address, parsedAmount],
      });
      return { txHash: '0x0000000000000000000000000000000000000000000000000000000000000000 (dry-run)' };
    }

    const { client } = makeWalletClient(rpcUrl, mnemonic, accountIndex, this.chainId);
    const hash = await client.writeContract({
      address: tokenAddress as Address,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [to as Address, parsedAmount],
    });
    return { txHash: hash };
  }

  async approveToken(
    mnemonic: string,
    accountIndex: number,
    tokenAddress: string,
    spender: string,
    amount: string,
    rpcUrl: string,
  ): Promise<TransferResult> {
    const isUnlimited = amount.toLowerCase() === 'unlimited';
    let parsedAmount: bigint;

    if (isUnlimited) {
      parsedAmount = maxUint256;
    } else {
      const info = await getTokenInfo(rpcUrl, tokenAddress as Address, this.chainId);
      parsedAmount = parseUnits(amount, info.decimals);
    }

    const { client } = makeWalletClient(rpcUrl, mnemonic, accountIndex, this.chainId);
    const hash = await client.writeContract({
      address: tokenAddress as Address,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender as Address, parsedAmount],
    });
    return { txHash: hash };
  }

  async transferFromToken(
    mnemonic: string,
    accountIndex: number,
    tokenAddress: string,
    from: string,
    to: string,
    amount: string,
    rpcUrl: string,
  ): Promise<TransferResult> {
    const info = await getTokenInfo(rpcUrl, tokenAddress as Address, this.chainId);
    const parsedAmount = parseUnits(amount, info.decimals);

    // Check allowance first
    const client = makePublicClient(rpcUrl, this.chainId);
    const account = getAccount(mnemonic, accountIndex);
    const allowance = await client.readContract({
      address: tokenAddress as Address,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [from as Address, account.address],
    });

    if (allowance < parsedAmount) {
      throw new WalletError(
        ErrorCodes.ERR_INSUFFICIENT_ALLOWANCE,
        `Insufficient allowance: have ${formatUnits(allowance, info.decimals)} ${info.symbol}, need ${amount} ${info.symbol}`,
      );
    }

    const { client: walletClient } = makeWalletClient(rpcUrl, mnemonic, accountIndex, this.chainId);
    const hash = await walletClient.writeContract({
      address: tokenAddress as Address,
      abi: erc20Abi,
      functionName: 'transferFrom',
      args: [from as Address, to as Address, parsedAmount],
    });
    return { txHash: hash };
  }

  async getAllowance(
    tokenAddress: string,
    owner: string,
    spender: string,
    rpcUrl: string,
  ): Promise<AllowanceResult> {
    const client = makePublicClient(rpcUrl, this.chainId);
    const [allowance, info] = await Promise.all([
      client.readContract({
        address: tokenAddress as Address,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [owner as Address, spender as Address],
      }),
      getTokenInfo(rpcUrl, tokenAddress as Address, this.chainId),
    ]);
    return {
      allowance: formatUnits(allowance, info.decimals),
      allowanceRaw: allowance.toString(),
      symbol: info.symbol,
      decimals: info.decimals,
    };
  }

  async signMessage(mnemonic: string, accountIndex: number, message: string): Promise<SignMessageResult> {
    const account = getAccount(mnemonic, accountIndex);
    const signature = await account.signMessage({ message });
    return {
      signature,
      address: account.address,
      messageHash: hashMessage(message),
    };
  }

  async signData(mnemonic: string, accountIndex: number, data: string): Promise<SignMessageResult> {
    const account = getAccount(mnemonic, accountIndex);
    const raw = { raw: (data.startsWith('0x') ? data : `0x${data}`) as Hex };
    const signature = await account.signMessage({ message: raw });
    return {
      signature,
      address: account.address,
    };
  }

  async signTypedData(
    mnemonic: string,
    accountIndex: number,
    typedData: { domain: any; types: any; primaryType: string; message: any },
  ): Promise<SignTypedDataResult> {
    const account = getAccount(mnemonic, accountIndex);

    // Remove EIP712Domain from types if present (viem handles it)
    const types = { ...typedData.types };
    delete types['EIP712Domain'];

    const signature = await account.signTypedData({
      domain: typedData.domain,
      types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });

    // Parse v, r, s from signature
    const r = `0x${signature.slice(2, 66)}` as Hex;
    const s = `0x${signature.slice(66, 130)}` as Hex;
    const v = parseInt(signature.slice(130, 132), 16);

    let typedDataHashHex: string | undefined;
    try {
      typedDataHashHex = hashTypedData({
        domain: typedData.domain,
        types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      });
    } catch {
      // Ignore hash computation failures
    }

    return {
      signature,
      address: account.address,
      v,
      r,
      s,
      typedDataHash: typedDataHashHex,
    };
  }

  async getApprovals(
    address: string,
    rpcUrl: string,
    limit: number,
  ): Promise<Array<{ tokenAddress: string; tokenSymbol: string; tokenDecimals: number; owner: string; spender: string; allowance: string; allowanceRaw: string; blockNumber?: number; timestamp?: number }>> {
    const client = makePublicClient(rpcUrl, this.chainId);
    const approvalEvent = parseAbiItem('event Approval(address indexed owner, address indexed spender, uint256 value)');

    const currentBlock = await client.getBlockNumber();
    const fromBlock = currentBlock > 9999n ? currentBlock - 9999n : 0n;

    // Find approvals where our address is the spender (granted TO us)
    // and approvals where our address is the owner (granted BY us)
    const [grantedToUs, grantedByUs] = await Promise.all([
      client.getLogs({
        event: approvalEvent,
        args: { spender: address as Address },
        fromBlock,
        toBlock: 'latest',
      }),
      client.getLogs({
        event: approvalEvent,
        args: { owner: address as Address },
        fromBlock,
        toBlock: 'latest',
      }),
    ]);

    const allLogs = [...grantedToUs, ...grantedByUs]
      .sort((a, b) => Number((b.blockNumber ?? 0n) - (a.blockNumber ?? 0n)));

    // Keep only the latest approval per (token, owner, spender) tuple
    const latestMap = new Map<string, typeof allLogs[0]>();
    for (const log of allLogs) {
      const key = `${log.address}-${log.args.owner}-${log.args.spender}`;
      if (!latestMap.has(key)) {
        latestMap.set(key, log);
      }
    }

    const uniqueLogs = [...latestMap.values()].slice(0, limit);

    // Fetch token metadata
    const tokenAddresses = [...new Set(uniqueLogs.map((l) => l.address.toLowerCase()))];
    const tokenInfoCache: Record<string, { symbol: string; decimals: number }> = {};
    await Promise.all(
      tokenAddresses.map(async (addr) => {
        try {
          tokenInfoCache[addr] = await getTokenInfo(rpcUrl, addr as Address, this.chainId);
        } catch {
          tokenInfoCache[addr] = { symbol: '???', decimals: 18 };
        }
      }),
    );

    // Fetch block timestamps
    const blockNumbers = [...new Set(uniqueLogs.map((l) => l.blockNumber).filter((b): b is bigint => b !== null))];
    const blockTimestamps: Record<string, number> = {};
    await Promise.all(
      blockNumbers.map(async (bn) => {
        try {
          const block = await client.getBlock({ blockNumber: bn });
          blockTimestamps[bn.toString()] = Number(block.timestamp);
        } catch {}
      }),
    );

    // For each approval event, check the current on-chain allowance
    const results = await Promise.all(
      uniqueLogs.map(async (log) => {
        const tokenAddr = log.address.toLowerCase();
        const info = tokenInfoCache[tokenAddr] ?? { symbol: '???', decimals: 18 };
        const owner = log.args.owner ?? '';
        const spender = log.args.spender ?? '';

        let currentAllowance = 0n;
        try {
          currentAllowance = await client.readContract({
            address: log.address as Address,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [owner as Address, spender as Address],
          });
        } catch {}

        return {
          tokenAddress: log.address,
          tokenSymbol: info.symbol,
          tokenDecimals: info.decimals,
          owner,
          spender,
          allowance: formatUnits(currentAllowance, info.decimals),
          allowanceRaw: currentAllowance.toString(),
          blockNumber: log.blockNumber ? Number(log.blockNumber) : undefined,
          timestamp: log.blockNumber ? blockTimestamps[log.blockNumber.toString()] : undefined,
        };
      }),
    );

    // Filter out zero allowances (revoked)
    return results.filter((r) => r.allowanceRaw !== '0');
  }

  async getHistory(
    address: string,
    rpcUrl: string,
    explorerApiUrl: string | undefined,
    limit: number,
  ): Promise<TransactionHistoryEntry[]> {
    const client = makePublicClient(rpcUrl, this.chainId);
    const entries: TransactionHistoryEntry[] = [];

    // Use viem's typed event filtering for ERC-20 Transfer events
    const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

    const currentBlock = await client.getBlockNumber();
    // Search last ~9999 blocks to stay within public RPC limits (most cap at 10k)
    const fromBlock = currentBlock > 9999n ? currentBlock - 9999n : 0n;

    // Fetch incoming and outgoing ERC-20 transfers in parallel
    const [incomingLogs, outgoingLogs] = await Promise.all([
      client.getLogs({
        event: transferEvent,
        args: { to: address as Address },
        fromBlock,
        toBlock: 'latest',
      }),
      client.getLogs({
        event: transferEvent,
        args: { from: address as Address },
        fromBlock,
        toBlock: 'latest',
      }),
    ]);

    const allLogs = [...incomingLogs, ...outgoingLogs]
      .sort((a, b) => Number((b.blockNumber ?? 0n) - (a.blockNumber ?? 0n)));

    // Deduplicate by tx hash + log index
    const seen = new Set<string>();
    const uniqueLogs = allLogs.filter((log) => {
      const key = `${log.transactionHash}-${log.logIndex}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, limit);

    // Batch-fetch token metadata for unique contract addresses
    const tokenAddresses = [...new Set(uniqueLogs.map((log) => log.address.toLowerCase()))];
    const tokenInfoCache: Record<string, { symbol: string; decimals: number }> = {};
    await Promise.all(
      tokenAddresses.map(async (addr) => {
        try {
          tokenInfoCache[addr] = await getTokenInfo(rpcUrl, addr as Address, this.chainId);
        } catch {
          tokenInfoCache[addr] = { symbol: '???', decimals: 18 };
        }
      }),
    );

    // Fetch block timestamps for all unique blocks
    const blockNumbers = [...new Set(uniqueLogs.map((log) => log.blockNumber).filter((b): b is bigint => b !== null))];
    const blockTimestamps: Record<string, number> = {};
    await Promise.all(
      blockNumbers.map(async (bn) => {
        try {
          const block = await client.getBlock({ blockNumber: bn });
          blockTimestamps[bn.toString()] = Number(block.timestamp);
        } catch {
          // skip
        }
      }),
    );

    for (const log of uniqueLogs) {
      const from = log.args.from ?? '';
      const to = log.args.to ?? '';
      const rawValue = log.args.value ?? 0n;
      const tokenAddr = log.address.toLowerCase();
      const info = tokenInfoCache[tokenAddr] ?? { symbol: '???', decimals: 18 };

      entries.push({
        hash: log.transactionHash ?? '',
        from,
        to,
        value: formatUnits(rawValue, info.decimals),
        blockNumber: log.blockNumber ? Number(log.blockNumber) : undefined,
        timestamp: log.blockNumber ? blockTimestamps[log.blockNumber.toString()] : undefined,
        status: 'success',
        type: 'erc20',
        tokenAddress: log.address,
        tokenSymbol: info.symbol,
        tokenDecimals: info.decimals,
      });
    }

    // Also try explorer API for native tx history (best-effort)
    if (explorerApiUrl) {
      try {
        const url = `${explorerApiUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=${limit}&sort=desc`;
        const response = await fetch(url);
        const data = await response.json() as any;
        if (data.status === '1' && Array.isArray(data.result)) {
          for (const tx of data.result) {
            entries.push({
              hash: tx.hash,
              from: tx.from,
              to: tx.to || '',
              value: formatEther(BigInt(tx.value)),
              timestamp: parseInt(tx.timeStamp),
              blockNumber: parseInt(tx.blockNumber),
              status: tx.isError === '0' ? 'success' as const : 'fail' as const,
              type: 'native',
            });
          }
        }
      } catch {
        // Explorer API failed, that's fine — we still have RPC-based token history
      }
    }

    return entries
      .sort((a, b) => (b.blockNumber ?? 0) - (a.blockNumber ?? 0))
      .slice(0, limit);
  }
}
