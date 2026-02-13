import type { Command } from 'commander';
import { resolveToken, validateSession } from '../core/session.js';
import { loadConfig, getNetworkConfig, resolveTokenAddress } from '../core/config.js';
import { EthereumAdapter } from '../chains/ethereum.js';
import { SolanaAdapter } from '../chains/solana.js';
import { outputSuccess, outputError, type OutputFormat } from '../output/formatter.js';
import { WalletError, ErrorCodes } from '../output/errors.js';
import { confirmTransaction } from '../security/input.js';

export function registerSendCommand(program: Command): void {
  program
    .command('send')
    .description('Transfer native coin or token')
    .option('--token <token>', 'Session token')
    .option('--chain <chain>', 'Chain (ethereum, solana)')
    .option('--network <network>', 'Network name', 'mainnet')
    .option('--to <address>', 'Recipient address')
    .option('--amount <amount>', 'Amount to send')
    .option('--token-address <address>', 'Token contract address or alias (e.g. usdc)')
    .option('--account-index <index>', 'Account index', '0')
    .option('--dry-run', 'Simulate transaction without sending')
    .option('--yes', 'Skip confirmation prompt')
    .option('--name <name>', 'Wallet name', 'default')
    .action(async (opts) => {
      const format: OutputFormat = program.opts().format ?? 'json';
      const walletDir: string = program.opts().walletDir;
      const quiet: boolean = program.opts().quiet ?? false;

      try {
        if (!opts.chain) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Chain is required (--chain ethereum|solana)');
        }
        if (!opts.to) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Recipient is required (--to)');
        }
        if (!opts.amount) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Amount is required (--amount)');
        }

        const sessionToken = await resolveToken(walletDir, opts.name, opts.token);
        const mnemonic = await validateSession(walletDir, opts.name, sessionToken);
        const config = await loadConfig(walletDir);
        const netConfig = getNetworkConfig(config, opts.chain, opts.network);
        const accountIndex = parseInt(opts.accountIndex) || 0;

        let adapter;
        if (opts.chain === 'ethereum') {
          adapter = new EthereumAdapter(netConfig.chainId);
        } else if (opts.chain === 'solana') {
          adapter = new SolanaAdapter();
        } else {
          throw new WalletError(ErrorCodes.ERR_CHAIN_NOT_SUPPORTED, `Unsupported chain: ${opts.chain}`);
        }

        // Prompt for confirmation unless --yes or --dry-run
        if (!opts.yes && !opts.dryRun) {
          const details: Record<string, string> = {
            Action: 'Send',
            Chain: opts.chain,
            Network: opts.network,
            Recipient: opts.to,
            Amount: opts.amount,
          };
          if (opts.tokenAddress) {
            details['Token'] = opts.tokenAddress;
          }
          const confirmed = await confirmTransaction(details);
          if (!confirmed) {
            throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Transaction cancelled by user');
          }
        }

        let result;
        if (opts.tokenAddress) {
          const resolved = resolveTokenAddress(config, opts.chain, opts.network, opts.tokenAddress);
          result = await adapter.transferToken(
            mnemonic,
            accountIndex,
            resolved.address,
            opts.to,
            opts.amount,
            netConfig.rpcUrl,
            opts.dryRun,
          );
        } else {
          result = await adapter.transfer(
            mnemonic,
            accountIndex,
            opts.to,
            opts.amount,
            netConfig.rpcUrl,
            opts.dryRun,
          );
        }

        const explorerUrl = netConfig.explorerUrl
          ? opts.chain === 'solana'
            ? `${netConfig.explorerUrl}/tx/${result.txHash}`
            : `${netConfig.explorerUrl}/tx/${result.txHash}`
          : undefined;

        outputSuccess(
          {
            tx_hash: result.txHash,
            chain: opts.chain,
            network: opts.network,
            dry_run: opts.dryRun ?? false,
            explorer_url: explorerUrl,
          },
          format,
          quiet,
        );
      } catch (error) {
        outputError(error, format, quiet);
      }
    });
}
