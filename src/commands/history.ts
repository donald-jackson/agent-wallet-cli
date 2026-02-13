import type { Command } from 'commander';
import { resolveToken, validateSession } from '../core/session.js';
import { loadConfig, getNetworkConfig } from '../core/config.js';
import { EthereumAdapter } from '../chains/ethereum.js';
import { SolanaAdapter } from '../chains/solana.js';
import { outputSuccess, outputError, type OutputFormat } from '../output/formatter.js';
import { WalletError, ErrorCodes } from '../output/errors.js';

export function registerHistoryCommand(program: Command): void {
  program
    .command('history')
    .description('List recent transactions')
    .option('--token <token>', 'Session token')
    .option('--chain <chain>', 'Chain (ethereum, solana)')
    .option('--network <network>', 'Network name', 'mainnet')
    .option('--limit <limit>', 'Number of transactions to show', '10')
    .option('--account-index <index>', 'Account index', '0')
    .option('--name <name>', 'Wallet name', 'default')
    .action(async (opts) => {
      const format: OutputFormat = program.opts().format ?? 'json';
      const walletDir: string = program.opts().walletDir;
      const quiet: boolean = program.opts().quiet ?? false;

      try {
        if (!opts.chain) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Chain is required (--chain ethereum|solana)');
        }

        const token = await resolveToken(walletDir, opts.name, opts.token);
        const mnemonic = await validateSession(walletDir, opts.name, token);
        const config = await loadConfig(walletDir);
        const netConfig = getNetworkConfig(config, opts.chain, opts.network);
        const accountIndex = parseInt(opts.accountIndex) || 0;
        const limit = parseInt(opts.limit) || 10;

        let adapter;
        if (opts.chain === 'ethereum') {
          adapter = new EthereumAdapter(netConfig.chainId);
        } else if (opts.chain === 'solana') {
          adapter = new SolanaAdapter();
        } else {
          throw new WalletError(ErrorCodes.ERR_CHAIN_NOT_SUPPORTED, `Unsupported chain: ${opts.chain}`);
        }

        const address = adapter.deriveAddress(mnemonic, accountIndex);
        const transactions = await adapter.getHistory(address, netConfig.rpcUrl, netConfig.explorerApiUrl, limit);

        // Add explorer URLs
        const enriched = transactions.map((tx) => ({
          ...tx,
          explorerUrl: netConfig.explorerUrl
            ? opts.chain === 'solana'
              ? `${netConfig.explorerUrl}/tx/${tx.hash}`
              : `${netConfig.explorerUrl}/tx/${tx.hash}`
            : undefined,
        }));

        outputSuccess(
          {
            chain: opts.chain,
            network: opts.network,
            address,
            transactions: enriched,
          },
          format,
          quiet,
        );
      } catch (error) {
        outputError(error, format, quiet);
      }
    });
}
