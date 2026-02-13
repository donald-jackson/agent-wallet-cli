import type { Command } from 'commander';
import { resolveToken, validateSession } from '../core/session.js';
import { loadConfig, getNetworkConfig, resolveTokenAddress, type ChainType } from '../core/config.js';
import { EthereumAdapter } from '../chains/ethereum.js';
import { SolanaAdapter } from '../chains/solana.js';
import { outputSuccess, outputError, type OutputFormat } from '../output/formatter.js';
import { WalletError, ErrorCodes } from '../output/errors.js';

export function registerBalanceCommand(program: Command): void {
  program
    .command('balance')
    .description('Query balance (native or token)')
    .option('--token <token>', 'Session token')
    .option('--chain <chain>', 'Chain (ethereum, solana)')
    .option('--network <network>', 'Network name', 'mainnet')
    .option('--token-address <address>', 'Token contract address or alias (e.g. usdc)')
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

        let adapter;
        if (opts.chain === 'ethereum') {
          adapter = new EthereumAdapter(netConfig.chainId);
        } else if (opts.chain === 'solana') {
          adapter = new SolanaAdapter();
        } else {
          throw new WalletError(ErrorCodes.ERR_CHAIN_NOT_SUPPORTED, `Unsupported chain: ${opts.chain}`);
        }

        const address = adapter.deriveAddress(mnemonic, accountIndex);

        if (opts.tokenAddress) {
          const resolved = resolveTokenAddress(config, opts.chain, opts.network, opts.tokenAddress);
          const result = await adapter.getTokenBalance(address, resolved.address, netConfig.rpcUrl);
          outputSuccess(
            {
              chain: opts.chain,
              network: opts.network,
              address,
              token_address: resolved.address,
              ...result,
              symbol: result.symbol || resolved.symbol || '',
            },
            format,
            quiet,
          );
        } else {
          const result = await adapter.getBalance(address, netConfig.rpcUrl);
          outputSuccess(
            {
              chain: opts.chain,
              network: opts.network,
              address,
              ...result,
            },
            format,
            quiet,
          );
        }
      } catch (error) {
        outputError(error, format, quiet);
      }
    });
}
