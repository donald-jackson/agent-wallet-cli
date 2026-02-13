import type { Command } from 'commander';
import { resolveToken, validateSession } from '../core/session.js';
import { loadConfig, getNetworkConfig } from '../core/config.js';
import { EthereumAdapter } from '../chains/ethereum.js';
import { outputSuccess, outputError, type OutputFormat } from '../output/formatter.js';
import { WalletError, ErrorCodes } from '../output/errors.js';

export function registerApprovalsCommand(program: Command): void {
  program
    .command('approvals')
    .description('Discover ERC-20 approvals granted to/by this wallet (scans recent Approval events)')
    .option('--token <token>', 'Session token')
    .option('--chain <chain>', 'Chain (ethereum)', 'ethereum')
    .option('--network <network>', 'Network name', 'mainnet')
    .option('--limit <limit>', 'Max results', '20')
    .option('--account-index <index>', 'Account index', '0')
    .option('--name <name>', 'Wallet name', 'default')
    .action(async (opts) => {
      const format: OutputFormat = program.opts().format ?? 'json';
      const walletDir: string = program.opts().walletDir;
      const quiet: boolean = program.opts().quiet ?? false;

      try {
        if (opts.chain !== 'ethereum') {
          throw new WalletError(ErrorCodes.ERR_CHAIN_NOT_SUPPORTED, 'Approvals discovery is currently only supported for EVM chains');
        }

        const sessionToken = await resolveToken(walletDir, opts.name, opts.token);
        const mnemonic = await validateSession(walletDir, opts.name, sessionToken);
        const config = await loadConfig(walletDir);
        const netConfig = getNetworkConfig(config, opts.chain, opts.network);
        const accountIndex = parseInt(opts.accountIndex) || 0;

        const adapter = new EthereumAdapter(netConfig.chainId);
        const address = adapter.deriveAddress(mnemonic, accountIndex);
        const limit = parseInt(opts.limit) || 20;

        const approvals = await adapter.getApprovals(address, netConfig.rpcUrl, limit);

        const grantedToUs = approvals.filter((a) => a.spender.toLowerCase() === address.toLowerCase());
        const grantedByUs = approvals.filter((a) => a.owner.toLowerCase() === address.toLowerCase());

        outputSuccess(
          {
            chain: opts.chain,
            network: opts.network,
            address,
            granted_to_wallet: grantedToUs,
            granted_by_wallet: grantedByUs,
          },
          format,
          quiet,
        );
      } catch (error) {
        outputError(error, format, quiet);
      }
    });
}
