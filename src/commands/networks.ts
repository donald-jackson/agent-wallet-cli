import type { Command } from 'commander';
import { loadConfig, saveNetworkConfig, resetNetworkConfig, DEFAULT_NETWORKS } from '../core/config.js';
import { outputSuccess, outputError, type OutputFormat } from '../output/formatter.js';
import { WalletError, ErrorCodes } from '../output/errors.js';

export function registerNetworksCommand(program: Command): void {
  program
    .command('networks')
    .description('List or configure RPC endpoints')
    .option('--set <chain:network>', 'Set RPC for chain:network (e.g. ethereum:mainnet)')
    .option('--rpc-url <url>', 'RPC URL (used with --set)')
    .option('--reset <chain:network>', 'Reset to default RPC')
    .action(async (opts) => {
      const format: OutputFormat = program.opts().format ?? 'json';
      const walletDir: string = program.opts().walletDir;
      const quiet: boolean = program.opts().quiet ?? false;

      try {
        if (opts.set) {
          if (!opts.rpcUrl) {
            throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, '--rpc-url is required with --set');
          }
          const [chain, network] = opts.set.split(':');
          if (!chain || !network) {
            throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Format: --set chain:network (e.g. ethereum:mainnet)');
          }
          await saveNetworkConfig(walletDir, chain, network, opts.rpcUrl);
          outputSuccess(
            {
              message: `RPC updated for ${chain}:${network}`,
              chain,
              network,
              rpc_url: opts.rpcUrl,
            },
            format,
            quiet,
          );
        } else if (opts.reset) {
          const [chain, network] = opts.reset.split(':');
          if (!chain || !network) {
            throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Format: --reset chain:network');
          }
          await resetNetworkConfig(walletDir, chain, network);
          const defaultUrl = DEFAULT_NETWORKS[chain]?.[network]?.rpcUrl ?? 'none';
          outputSuccess(
            {
              message: `RPC reset to default for ${chain}:${network}`,
              chain,
              network,
              rpc_url: defaultUrl,
            },
            format,
            quiet,
          );
        } else {
          // List all networks
          const config = await loadConfig(walletDir);
          const networkList: Array<{ chain: string; network: string; rpc_url: string; explorer?: string }> = [];

          for (const [chain, networks] of Object.entries(config.networks)) {
            for (const [network, netConfig] of Object.entries(networks)) {
              networkList.push({
                chain,
                network,
                rpc_url: netConfig.rpcUrl,
                explorer: netConfig.explorerUrl,
              });
            }
          }

          outputSuccess({ networks: networkList }, format, quiet);
        }
      } catch (error) {
        outputError(error, format, quiet);
      }
    });
}
