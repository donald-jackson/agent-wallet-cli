import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  createApproveInstruction,
  getAccount as getTokenAccount,
  getMint,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { deriveSolanaKeypair, deriveSolanaAddress } from '../core/mnemonic.js';
import { clearUint8Array } from '../security/memory.js';
import { WalletError, ErrorCodes } from '../output/errors.js';
import type {
  ChainAdapter,
  TransferResult,
  BalanceResult,
  AllowanceResult,
  SignMessageResult,
  TransactionHistoryEntry,
} from './types.js';

export class SolanaAdapter implements ChainAdapter {
  readonly chain = 'solana';

  deriveAddress(mnemonic: string, accountIndex = 0): string {
    return deriveSolanaAddress(mnemonic, accountIndex).address;
  }

  async getBalance(address: string, rpcUrl: string): Promise<BalanceResult> {
    const connection = new Connection(rpcUrl);
    const pubkey = new PublicKey(address);
    const balance = await connection.getBalance(pubkey);
    return {
      balance: (balance / LAMPORTS_PER_SOL).toString(),
      balanceRaw: balance.toString(),
      symbol: 'SOL',
      decimals: 9,
    };
  }

  async getTokenBalance(address: string, tokenAddress: string, rpcUrl: string): Promise<BalanceResult> {
    const connection = new Connection(rpcUrl);
    const owner = new PublicKey(address);
    const mint = new PublicKey(tokenAddress);

    const mintInfo = await getMint(connection, mint);
    const ata = await getAssociatedTokenAddress(mint, owner);

    try {
      const account = await getTokenAccount(connection, ata);
      const balance = account.amount;
      return {
        balance: formatSplAmount(balance, mintInfo.decimals),
        balanceRaw: balance.toString(),
        symbol: '', // SPL tokens don't store symbol on-chain; would need metadata
        decimals: mintInfo.decimals,
      };
    } catch {
      // Token account doesn't exist — balance is 0
      return {
        balance: '0',
        balanceRaw: '0',
        symbol: '',
        decimals: mintInfo.decimals,
      };
    }
  }

  async transfer(
    mnemonic: string,
    accountIndex: number,
    to: string,
    amount: string,
    rpcUrl: string,
    dryRun = false,
  ): Promise<TransferResult> {
    const connection = new Connection(rpcUrl);
    const keypair = deriveSolanaKeypair(mnemonic, accountIndex);

    try {
      const lamports = Math.round(parseFloat(amount) * LAMPORTS_PER_SOL);
      const toPubkey = new PublicKey(to);

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey,
          lamports,
        }),
      );

      if (dryRun) {
        tx.feePayer = keypair.publicKey;
        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        await connection.simulateTransaction(tx);
        return { txHash: '0'.repeat(88) + ' (dry-run)' };
      }

      const signature = await sendAndConfirmTransaction(connection, tx, [keypair]);
      return { txHash: signature };
    } finally {
      clearUint8Array(keypair.secretKey);
    }
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
    const connection = new Connection(rpcUrl);
    const keypair = deriveSolanaKeypair(mnemonic, accountIndex);

    try {
      const mint = new PublicKey(tokenAddress);
      const toPubkey = new PublicKey(to);
      const mintInfo = await getMint(connection, mint);
      const parsedAmount = parseSplAmount(amount, mintInfo.decimals);

      const senderAta = await getAssociatedTokenAddress(mint, keypair.publicKey);
      const recipientAta = await getAssociatedTokenAddress(mint, toPubkey);

      const tx = new Transaction();

      // Create recipient ATA if it doesn't exist
      try {
        await getTokenAccount(connection, recipientAta);
      } catch {
        tx.add(
          createAssociatedTokenAccountInstruction(
            keypair.publicKey, // payer
            recipientAta,
            toPubkey,
            mint,
          ),
        );
      }

      tx.add(
        createTransferCheckedInstruction(
          senderAta,
          mint,
          recipientAta,
          keypair.publicKey,
          parsedAmount,
          mintInfo.decimals,
        ),
      );

      if (dryRun) {
        tx.feePayer = keypair.publicKey;
        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        await connection.simulateTransaction(tx);
        return { txHash: '0'.repeat(88) + ' (dry-run)' };
      }

      const signature = await sendAndConfirmTransaction(connection, tx, [keypair]);
      return { txHash: signature };
    } finally {
      clearUint8Array(keypair.secretKey);
    }
  }

  async approveToken(
    mnemonic: string,
    accountIndex: number,
    tokenAddress: string,
    spender: string,
    amount: string,
    rpcUrl: string,
  ): Promise<TransferResult> {
    const connection = new Connection(rpcUrl);
    const keypair = deriveSolanaKeypair(mnemonic, accountIndex);

    try {
      const mint = new PublicKey(tokenAddress);
      const delegatePubkey = new PublicKey(spender);
      const mintInfo = await getMint(connection, mint);

      const isUnlimited = amount.toLowerCase() === 'unlimited';
      const parsedAmount = isUnlimited ? BigInt('18446744073709551615') : parseSplAmount(amount, mintInfo.decimals);

      const ownerAta = await getAssociatedTokenAddress(mint, keypair.publicKey);

      const tx = new Transaction().add(
        createApproveInstruction(
          ownerAta,
          delegatePubkey,
          keypair.publicKey,
          parsedAmount,
        ),
      );

      const signature = await sendAndConfirmTransaction(connection, tx, [keypair]);
      return { txHash: signature };
    } finally {
      clearUint8Array(keypair.secretKey);
    }
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
    // On Solana, delegated transfers are executed by the delegate calling transfer
    // on the token account directly. This is different from ERC-20 transferFrom.
    const connection = new Connection(rpcUrl);
    const keypair = deriveSolanaKeypair(mnemonic, accountIndex);

    try {
      const mint = new PublicKey(tokenAddress);
      const fromOwner = new PublicKey(from);
      const toOwner = new PublicKey(to);
      const mintInfo = await getMint(connection, mint);
      const parsedAmount = parseSplAmount(amount, mintInfo.decimals);

      const sourceAta = await getAssociatedTokenAddress(mint, fromOwner);
      const destAta = await getAssociatedTokenAddress(mint, toOwner);

      // Check delegation
      const sourceAccount = await getTokenAccount(connection, sourceAta);
      if (!sourceAccount.delegate || sourceAccount.delegate.toBase58() !== keypair.publicKey.toBase58()) {
        throw new WalletError(
          ErrorCodes.ERR_INSUFFICIENT_ALLOWANCE,
          'This wallet is not an approved delegate for the source token account',
        );
      }

      if (sourceAccount.delegatedAmount < parsedAmount) {
        throw new WalletError(
          ErrorCodes.ERR_INSUFFICIENT_ALLOWANCE,
          `Insufficient delegated amount: have ${formatSplAmount(sourceAccount.delegatedAmount, mintInfo.decimals)}, need ${amount}`,
        );
      }

      const tx = new Transaction();

      // Create recipient ATA if needed
      try {
        await getTokenAccount(connection, destAta);
      } catch {
        tx.add(
          createAssociatedTokenAccountInstruction(
            keypair.publicKey,
            destAta,
            toOwner,
            mint,
          ),
        );
      }

      tx.add(
        createTransferCheckedInstruction(
          sourceAta,
          mint,
          destAta,
          keypair.publicKey, // delegate as authority
          parsedAmount,
          mintInfo.decimals,
        ),
      );

      const signature = await sendAndConfirmTransaction(connection, tx, [keypair]);
      return { txHash: signature };
    } finally {
      clearUint8Array(keypair.secretKey);
    }
  }

  async getAllowance(
    tokenAddress: string,
    owner: string,
    spender: string,
    rpcUrl: string,
  ): Promise<AllowanceResult> {
    const connection = new Connection(rpcUrl);
    const mint = new PublicKey(tokenAddress);
    const ownerPubkey = new PublicKey(owner);
    const mintInfo = await getMint(connection, mint);

    const ownerAta = await getAssociatedTokenAddress(mint, ownerPubkey);

    try {
      const account = await getTokenAccount(connection, ownerAta);
      if (account.delegate && account.delegate.toBase58() === spender) {
        return {
          allowance: formatSplAmount(account.delegatedAmount, mintInfo.decimals),
          allowanceRaw: account.delegatedAmount.toString(),
          symbol: '',
          decimals: mintInfo.decimals,
        };
      }
      return {
        allowance: '0',
        allowanceRaw: '0',
        symbol: '',
        decimals: mintInfo.decimals,
      };
    } catch {
      return {
        allowance: '0',
        allowanceRaw: '0',
        symbol: '',
        decimals: mintInfo.decimals,
      };
    }
  }

  async signMessage(mnemonic: string, accountIndex: number, message: string): Promise<SignMessageResult> {
    const keypair = deriveSolanaKeypair(mnemonic, accountIndex);
    try {
      const messageBytes = Buffer.from(message, 'utf-8');
      const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
      return {
        signature: bs58.encode(signature),
        address: keypair.publicKey.toBase58(),
        messageHash: Buffer.from(messageBytes).toString('hex'),
      };
    } finally {
      clearUint8Array(keypair.secretKey);
    }
  }

  async signData(mnemonic: string, accountIndex: number, data: string): Promise<SignMessageResult> {
    const keypair = deriveSolanaKeypair(mnemonic, accountIndex);
    try {
      const dataBytes = Buffer.from(data.startsWith('0x') ? data.slice(2) : data, 'hex');
      const signature = nacl.sign.detached(dataBytes, keypair.secretKey);
      return {
        signature: bs58.encode(signature),
        address: keypair.publicKey.toBase58(),
        messageHash: Buffer.from(dataBytes).toString('hex'),
      };
    } finally {
      clearUint8Array(keypair.secretKey);
    }
  }

  async getHistory(
    address: string,
    rpcUrl: string,
    _explorerApiUrl: string | undefined,
    limit: number,
  ): Promise<TransactionHistoryEntry[]> {
    const connection = new Connection(rpcUrl);
    const pubkey = new PublicKey(address);

    const signatures = await connection.getSignaturesForAddress(pubkey, { limit });
    const entries: TransactionHistoryEntry[] = [];

    for (const sig of signatures) {
      entries.push({
        hash: sig.signature,
        from: '',
        to: '',
        value: '',
        timestamp: sig.blockTime ?? undefined,
        blockNumber: sig.slot,
        status: sig.err ? 'fail' : 'success',
      });
    }

    return entries;
  }
}

function parseSplAmount(amount: string, decimals: number): bigint {
  const parts = amount.split('.');
  const whole = parts[0];
  const frac = (parts[1] || '').padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole + frac);
}

function formatSplAmount(amount: bigint, decimals: number): string {
  const str = amount.toString().padStart(decimals + 1, '0');
  const whole = str.slice(0, str.length - decimals) || '0';
  const frac = str.slice(str.length - decimals);
  if (frac === '0'.repeat(decimals)) return whole;
  return `${whole}.${frac.replace(/0+$/, '')}`;
}
