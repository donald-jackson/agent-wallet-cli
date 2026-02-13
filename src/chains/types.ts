export interface TransferResult {
  txHash: string;
  explorerUrl?: string;
}

export interface BalanceResult {
  balance: string;
  balanceRaw: string;
  symbol: string;
  decimals: number;
}

export interface AllowanceResult {
  allowance: string;
  allowanceRaw: string;
  symbol: string;
  decimals: number;
}

export interface SignMessageResult {
  signature: string;
  address: string;
  messageHash?: string;
}

export interface SignTypedDataResult {
  signature: string;
  address: string;
  v?: number;
  r?: string;
  s?: string;
  typedDataHash?: string;
}

export interface TransactionHistoryEntry {
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp?: number;
  blockNumber?: number;
  status?: 'success' | 'fail' | 'pending';
  explorerUrl?: string;
  type?: 'native' | 'erc20' | 'spl';
  tokenAddress?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
}

export interface ChainAdapter {
  readonly chain: string;

  /** Derive address from mnemonic. */
  deriveAddress(mnemonic: string, accountIndex?: number): string;

  /** Get native coin balance. */
  getBalance(address: string, rpcUrl: string): Promise<BalanceResult>;

  /** Get token balance (ERC-20 or SPL). */
  getTokenBalance(address: string, tokenAddress: string, rpcUrl: string): Promise<BalanceResult>;

  /** Transfer native coin. */
  transfer(
    mnemonic: string,
    accountIndex: number,
    to: string,
    amount: string,
    rpcUrl: string,
    dryRun?: boolean,
  ): Promise<TransferResult>;

  /** Transfer token (ERC-20 or SPL). */
  transferToken(
    mnemonic: string,
    accountIndex: number,
    tokenAddress: string,
    to: string,
    amount: string,
    rpcUrl: string,
    dryRun?: boolean,
  ): Promise<TransferResult>;

  /** Approve spender for token. */
  approveToken(
    mnemonic: string,
    accountIndex: number,
    tokenAddress: string,
    spender: string,
    amount: string,
    rpcUrl: string,
  ): Promise<TransferResult>;

  /** Transfer token on behalf of owner (ERC-20 transferFrom). */
  transferFromToken(
    mnemonic: string,
    accountIndex: number,
    tokenAddress: string,
    from: string,
    to: string,
    amount: string,
    rpcUrl: string,
  ): Promise<TransferResult>;

  /** Query token allowance. */
  getAllowance(
    tokenAddress: string,
    owner: string,
    spender: string,
    rpcUrl: string,
  ): Promise<AllowanceResult>;

  /** Sign a message. */
  signMessage(
    mnemonic: string,
    accountIndex: number,
    message: string,
  ): Promise<SignMessageResult>;

  /** Sign raw data bytes. */
  signData(
    mnemonic: string,
    accountIndex: number,
    data: string,
  ): Promise<SignMessageResult>;

  /** Get transaction history. */
  getHistory(
    address: string,
    rpcUrl: string,
    explorerApiUrl: string | undefined,
    limit: number,
  ): Promise<TransactionHistoryEntry[]>;
}
