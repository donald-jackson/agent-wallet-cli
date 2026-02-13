import { readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import { resolveToken, validateSession } from '../core/session.js';
import { EthereumAdapter } from '../chains/ethereum.js';
import { SolanaAdapter } from '../chains/solana.js';
import { outputSuccess, outputError, type OutputFormat } from '../output/formatter.js';
import { WalletError, ErrorCodes } from '../output/errors.js';
import { loadConfig, getNetworkConfig } from '../core/config.js';

export function registerSignCommand(program: Command): void {
  program
    .command('sign')
    .description('Sign message, EIP-712 typed data, or raw bytes')
    .option('--token <token>', 'Session token')
    .option('--chain <chain>', 'Chain (ethereum, solana)')
    .option('--message <message>', 'Message to sign')
    .option('--typed-data <json>', 'EIP-712 typed data (JSON string or @filepath)')
    .option('--data <hex>', 'Raw bytes to sign (hex)')
    .option('--account-index <index>', 'Account index', '0')
    .option('--name <name>', 'Wallet name', 'default')
    .action(async (opts) => {
      const format: OutputFormat = program.opts().format ?? 'json';
      const walletDir: string = program.opts().walletDir;
      const quiet: boolean = program.opts().quiet ?? false;

      try {
        if (!opts.chain) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Chain is required (--chain)');
        }
        if (!opts.message && !opts.typedData && !opts.data) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'One of --message, --typed-data, or --data is required');
        }

        const sessionToken = await resolveToken(walletDir, opts.name, opts.token);
        const mnemonic = await validateSession(walletDir, opts.name, sessionToken);
        const accountIndex = parseInt(opts.accountIndex) || 0;

        if (opts.chain === 'ethereum') {
          const config = await loadConfig(walletDir);
          const adapter = new EthereumAdapter();

          if (opts.typedData) {
            // EIP-712 typed data signing
            let typedDataJson: string;
            if (opts.typedData.startsWith('@')) {
              typedDataJson = await readFile(opts.typedData.slice(1), 'utf-8');
            } else {
              typedDataJson = opts.typedData;
            }

            const typedData = JSON.parse(typedDataJson);
            const result = await adapter.signTypedData(mnemonic, accountIndex, typedData);

            outputSuccess(
              {
                signature: result.signature,
                address: result.address,
                v: result.v,
                r: result.r,
                s: result.s,
                typed_data_hash: result.typedDataHash,
              },
              format,
              quiet,
            );
          } else if (opts.message) {
            const result = await adapter.signMessage(mnemonic, accountIndex, opts.message);
            outputSuccess(
              {
                signature: result.signature,
                address: result.address,
                message_hash: result.messageHash,
              },
              format,
              quiet,
            );
          } else if (opts.data) {
            const result = await adapter.signData(mnemonic, accountIndex, opts.data);
            outputSuccess(
              {
                signature: result.signature,
                address: result.address,
              },
              format,
              quiet,
            );
          }
        } else if (opts.chain === 'solana') {
          const adapter = new SolanaAdapter();

          if (opts.typedData) {
            throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'EIP-712 typed data is not supported on Solana. Use --message or --data instead.');
          } else if (opts.message) {
            const result = await adapter.signMessage(mnemonic, accountIndex, opts.message);
            outputSuccess(
              {
                signature: result.signature,
                public_key: result.address,
                message_hash: result.messageHash,
              },
              format,
              quiet,
            );
          } else if (opts.data) {
            const result = await adapter.signData(mnemonic, accountIndex, opts.data);
            outputSuccess(
              {
                signature: result.signature,
                public_key: result.address,
                message_hash: result.messageHash,
              },
              format,
              quiet,
            );
          }
        } else {
          throw new WalletError(ErrorCodes.ERR_CHAIN_NOT_SUPPORTED, `Unsupported chain: ${opts.chain}`);
        }
      } catch (error) {
        outputError(error, format, quiet);
      }
    });
}
