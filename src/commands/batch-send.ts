import type { Command } from 'commander';
import { resolveToken, validateSession } from '../core/session.js';
import { loadConfig, getNetworkConfig, resolveTokenAddress } from '../core/config.js';
import { EthereumAdapter } from '../chains/ethereum.js';
import { SolanaAdapter } from '../chains/solana.js';
import { outputSuccess, outputError, type OutputFormat } from '../output/formatter.js';
import { WalletError, ErrorCodes } from '../output/errors.js';
import { confirmTransaction } from '../security/input.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Types -----------------------------------------------------------------------

interface Recipient {
  to: string;
  amount: string;
  reference?: string;
}

interface BatchResult {
  index: number;
  to: string;
  amount: string;
  reference?: string;
  ok: boolean;
  tx_hash?: string;
  explorer_url?: string;
  relay_used?: boolean;
  relay_fee?: string;
  error?: string;
}

// Helpers ---------------------------------------------------------------------

/**
 * Parse a CSV string into Recipient[].
 * Expected columns: to, amount, reference (optional)
 * First row must be a header row.
 */
function parseCSV(raw: string): Recipient[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'CSV must contain a header row and at least one data row');
  }

  const headers = lines[0].toLowerCase().split(',').map((h) => h.trim());
  const toIdx = headers.indexOf('to');
  const amountIdx = headers.indexOf('amount');
  const refIdx = headers.indexOf('reference');

  if (toIdx === -1 || amountIdx === -1) {
    throw new WalletError(
      ErrorCodes.ERR_INVALID_INPUT,
      'CSV header must include "to" and "amount" columns. Optional: "reference"'
    );
  }

  return lines.slice(1).map((line, i) => {
    const cols = line.split(',').map((c) => c.trim());
    const to = cols[toIdx];
    const amount = cols[amountIdx];

    if (!to || !amount) {
      throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, `Row ${i + 2}: missing "to" or "amount" value`);
    }

    const recipient: Recipient = { to, amount };
    if (refIdx !== -1 && cols[refIdx]) {
      recipient.reference = cols[refIdx];
    }
    return recipient;
  });
}

/**
 * Load recipients from a file path (JSON array or CSV).
 */
function loadRecipientsFromFile(filePath: string): Recipient[] {
  const absPath = resolve(filePath);
  const raw = readFileSync(absPath, 'utf-8');

  if (filePath.endsWith('.csv')) {
    return parseCSV(raw);
  }

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'JSON file must contain an array of recipients');
  }

  return parsed.map((item: any, i: number) => {
    if (!item.to || !item.amount) {
      throw new WalletError(
        ErrorCodes.ERR_INVALID_INPUT,
        `Recipient at index ${i}: missing required "to" or "amount" field`
      );
    }
    return {
      to: String(item.to),
      amount: String(item.amount),
      reference: item.reference ? String(item.reference) : undefined,
    };
  });
}

/**
 * Parse inline JSON string of recipients.
 */
function parseInlineRecipients(jsonStr: string): Recipient[] {
  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed)) {
    throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, '--recipients must be a JSON array');
  }

  return parsed.map((item: any, i: number) => {
    if (!item.to || !item.amount) {
      throw new WalletError(
        ErrorCodes.ERR_INVALID_INPUT,
        `Recipient at index ${i}: missing required "to" or "amount" field`
      );
    }
    return {
      to: String(item.to),
      amount: String(item.amount),
      reference: item.reference ? String(item.reference) : undefined,
    };
  });
}

// Command registration --------------------------------------------------------

export function registerBatchSendCommand(program: Command): void {
  program
    .command('batch-send')
    .description('Send tokens or native currency to multiple recipients in one operation')
    .option('--token <token>', 'Session token')
    .requiredOption('--chain <chain>', 'Chain (ethereum, solana)')
    .option('--network <network>', 'Network name', 'mainnet')
    .option('--to-file <path>', 'Path to JSON or CSV file containing recipients')
    .option('--recipients <json>', 'Inline JSON array of recipients')
    .option('--token-address <address>', 'Token contract address or alias (e.g. usdc)')
    .option('--account-index <index>', 'Account index', '0')
    .option('--dry-run', 'Simulate transactions without sending')
    .option('--no-relay', 'Disable gasless relay fallback')
    .option('--continue-on-error', 'Continue processing if a transfer fails')
    .option('--name <name>', 'Wallet name', 'default')
    .action(async (opts) => {
      const format: OutputFormat = program.opts().format ?? 'json';
      const walletDir: string = program.opts().walletDir;
      const quiet: boolean = program.opts().quiet ?? false;

      try {
        // ── Validate inputs ──────────────────────────────────────────
        if (!opts.toFile && !opts.recipients) {
          throw new WalletError(
            ErrorCodes.ERR_INVALID_INPUT,
            'Provide --to-file <path> or --recipients <json> with recipient data'
          );
        }
        if (opts.toFile && opts.recipients) {
          throw new WalletError(
            ErrorCodes.ERR_INVALID_INPUT,
            'Provide either --to-file or --recipients, not both'
          );
        }

        // ── Load recipients ──────────────────────────────────────────
        const recipients: Recipient[] = opts.toFile
          ? loadRecipientsFromFile(opts.toFile)
          : parseInlineRecipients(opts.recipients);

        if (recipients.length === 0) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Recipient list is empty');
        }

        // ── Resolve session & config ─────────────────────────────────
        const sessionToken = await resolveToken(walletDir, opts.name, opts.token);
        const mnemonic = await validateSession(walletDir, opts.name, sessionToken);
        const config = await loadConfig(walletDir);
        const netConfig = getNetworkConfig(config, opts.chain, opts.network);
        const accountIndex = parseInt(opts.accountIndex) || 0;

        // ── Create chain adapter ─────────────────────────────────────
        let adapter;
        if (opts.chain === 'ethereum') {
          adapter = new EthereumAdapter(netConfig.chainId);
        } else if (opts.chain === 'solana') {
          adapter = new SolanaAdapter();
        } else {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, `Unsupported chain: ${opts.chain}`);
        }

        // ── Resolve token address if alias ───────────────────────────
        let tokenAddress = opts.tokenAddress;
        if (tokenAddress) {
          tokenAddress = resolveTokenAddress(tokenAddress, opts.chain, opts.network) || tokenAddress;
        }

        // ── Confirm batch ────────────────────────────────────────────
        const totalAmount = recipients.reduce((sum, r) => sum + parseFloat(r.amount), 0);
        if (!opts.dryRun && !quiet) {
          const tokenLabel = tokenAddress || 'native';
          const confirmed = await confirmTransaction(
            `Send ${totalAmount} ${tokenLabel} to ${recipients.length} recipients on ${opts.chain}/${opts.network}?`
          );
          if (!confirmed) {
            outputSuccess(format, { ok: false, message: 'Batch cancelled by user' });
            return;
          }
        }

        // ── Execute transfers sequentially ───────────────────────────
        const results: BatchResult[] = [];
        let succeeded = 0;
        let failed = 0;

        for (let i = 0; i < recipients.length; i++) {
          const r = recipients[i];
          try {
            let result;

            if (opts.dryRun) {
              result = {
                ok: true,
                tx_hash: `dry_run_${i}`,
                explorer_url: '',
                relay_used: false,
              };
            } else if (tokenAddress) {
              // ERC-20 / SPL token transfer
              result = await adapter.transferToken({
                mnemonic,
                accountIndex,
                tokenAddress,
                to: r.to,
                amount: r.amount,
                rpcUrl: netConfig.rpcUrl,
                noRelay: opts.relay === false,
              });
            } else {
              // Native transfer
              result = await adapter.transferNative({
                mnemonic,
                accountIndex,
                to: r.to,
                amount: r.amount,
                rpcUrl: netConfig.rpcUrl,
              });
            }

            results.push({
              index: i,
              to: r.to,
              amount: r.amount,
              reference: r.reference,
              ok: true,
              tx_hash: result.tx_hash,
              explorer_url: result.explorer_url,
              relay_used: result.relay_used,
              relay_fee: result.relay_fee,
            });
            succeeded++;
          } catch (err: any) {
            results.push({
              index: i,
              to: r.to,
              amount: r.amount,
              reference: r.reference,
              ok: false,
              error: err.message || String(err),
            });
            failed++;

            if (!opts.continueOnError) {
              break;
            }
          }
        }

        // ── Output summary ───────────────────────────────────────────
        const sentAmount = results
          .filter((r) => r.ok)
          .reduce((sum, r) => sum + parseFloat(r.amount), 0)
          .toString();

        outputSuccess(format, {
          ok: failed === 0,
          total: recipients.length,
          succeeded,
          failed,
          total_amount: sentAmount,
          token_address: tokenAddress,
          chain: opts.chain,
          network: opts.network,
          dry_run: Boolean(opts.dryRun),
          results,
        });

        if (failed > 0) {
          process.exitCode = 1;
        }
      } catch (err: any) {
        outputError(format, err);
        process.exitCode = 1;
      }
    });
}
