import type { Command } from 'commander';
import { loadConfig, getNetworkConfig, resolveTokenAddress } from '../core/config.js';
import { EthereumAdapter } from '../chains/ethereum.js';
import { SolanaAdapter } from '../chains/solana.js';
import { outputSuccess, outputError, type OutputFormat } from '../output/formatter.js';
import { WalletError, ErrorCodes } from '../output/errors.js';

export function registerAllowanceCommand(program: Command): void {
  program
    .command('allowance')
    .description('Query ERC-20 allowance / SPL delegation')
    .option('--chain <chain>', 'Chain (ethereum, solana)')
    .option('--network <network>', 'Network name', 'mainnet')
    .option('--token-address <address>', 'Token contract address or alias')
    .option('--owner <address>', 'Token owner address')
    .option('--spender <address>', 'Spender/delegate address')
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
        if (!opts.owner) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Owner is required (--owner)');
        }
        if (!opts.spender) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Spender is required (--spender)');
        }

        const config = await loadConfig(walletDir);
        const netConfig = getNetworkConfig(config, opts.chain, opts.network);

        let adapter;
        if (opts.chain === 'ethereum') {
          adapter = new EthereumAdapter(netConfig.chainId);
        } else if (opts.chain === 'solana') {
          adapter = new SolanaAdapter();
        } else {
          throw new WalletError(ErrorCodes.ERR_CHAIN_NOT_SUPPORTED, `Unsupported chain: ${opts.chain}`);
        }

        const resolved = resolveTokenAddress(config, opts.chain, opts.network, opts.tokenAddress);
        const result = await adapter.getAllowance(
          resolved.address,
          opts.owner,
          opts.spender,
          netConfig.rpcUrl,
        );

        outputSuccess(
          {
            chain: opts.chain,
            network: opts.network,
            token_address: resolved.address,
            owner: opts.owner,
            spender: opts.spender,
            allowance: result.allowance,
            allowance_raw: result.allowanceRaw,
            symbol: result.symbol || resolved.symbol || '',
            decimals: result.decimals,
          },
          format,
          quiet,
        );
      } catch (error) {
        outputError(error, format, quiet);
      }
    });
}
