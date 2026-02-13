import type { Command } from 'commander';
import { resolveToken, validateSession } from '../core/session.js';
import { loadConfig, getNetworkConfig, resolveTokenAddress } from '../core/config.js';
import { EthereumAdapter } from '../chains/ethereum.js';
import { SolanaAdapter } from '../chains/solana.js';
import { outputSuccess, outputError, type OutputFormat } from '../output/formatter.js';
import { WalletError, ErrorCodes } from '../output/errors.js';
import { confirmTransaction } from '../security/input.js';

export function registerApproveCommand(program: Command): void {
  program
    .command('approve')
    .description('Approve spender for ERC-20 / SPL token delegate')
    .option('--token <token>', 'Session token')
    .option('--chain <chain>', 'Chain (ethereum, solana)')
    .option('--network <network>', 'Network name', 'mainnet')
    .option('--token-address <address>', 'Token contract address or alias')
    .option('--spender <address>', 'Spender/delegate address')
    .option('--amount <amount>', 'Amount to approve (or "unlimited")')
    .option('--account-index <index>', 'Account index', '0')
    .option('--yes', 'Skip confirmation prompt')
    .option('--name <name>', 'Wallet name', 'default')
    .action(async (opts) => {
      const format: OutputFormat = program.opts().format ?? 'json';
      const walletDir: string = program.opts().walletDir;
      const quiet: boolean = program.opts().quiet ?? false;

      try {
        if (!opts.chain) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Chain is required (--chain)');
        }
        if (!opts.tokenAddress) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Token address is required (--token-address)');
        }
        if (!opts.spender) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Spender is required (--spender)');
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

        // Prompt for confirmation unless --yes
        if (!opts.yes) {
          const confirmed = await confirmTransaction({
            Action: 'Approve spender',
            Chain: opts.chain,
            Network: opts.network,
            Token: opts.tokenAddress,
            Spender: opts.spender,
            Amount: opts.amount,
          });
          if (!confirmed) {
            throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Transaction cancelled by user');
          }
        }

        const resolved = resolveTokenAddress(config, opts.chain, opts.network, opts.tokenAddress);
        const result = await adapter.approveToken(
          mnemonic,
          accountIndex,
          resolved.address,
          opts.spender,
          opts.amount,
          netConfig.rpcUrl,
        );

        outputSuccess(
          {
            tx_hash: result.txHash,
            chain: opts.chain,
            network: opts.network,
            token_address: resolved.address,
            spender: opts.spender,
            amount: opts.amount,
          },
          format,
          quiet,
        );
      } catch (error) {
        outputError(error, format, quiet);
      }
    });
}
