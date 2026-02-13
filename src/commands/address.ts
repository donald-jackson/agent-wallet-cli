import type { Command } from 'commander';
import { resolveToken, validateSession } from '../core/session.js';
import { deriveEthereumAddress, deriveSolanaAddress, deriveAddresses } from '../core/mnemonic.js';
import { outputSuccess, outputError, type OutputFormat } from '../output/formatter.js';
import { WalletError, ErrorCodes } from '../output/errors.js';

export function registerAddressCommand(program: Command): void {
  program
    .command('address')
    .description('Show wallet addresses')
    .option('--token <token>', 'Session token')
    .option('--chain <chain>', 'Chain (ethereum, solana)')
    .option('--account-index <index>', 'Account index', '0')
    .option('--name <name>', 'Wallet name', 'default')
    .action(async (opts) => {
      const format: OutputFormat = program.opts().format ?? 'json';
      const walletDir: string = program.opts().walletDir;
      const quiet: boolean = program.opts().quiet ?? false;

      try {
        const token = await resolveToken(walletDir, opts.name, opts.token);
        const mnemonic = await validateSession(walletDir, opts.name, token);
        const accountIndex = parseInt(opts.accountIndex) || 0;

        if (opts.chain === 'ethereum') {
          const { address } = deriveEthereumAddress(mnemonic, accountIndex);
          outputSuccess({ chain: 'ethereum', address, account_index: accountIndex }, format, quiet);
        } else if (opts.chain === 'solana') {
          const { address } = deriveSolanaAddress(mnemonic, accountIndex);
          outputSuccess({ chain: 'solana', address, account_index: accountIndex }, format, quiet);
        } else {
          const addresses = deriveAddresses(mnemonic, accountIndex);
          outputSuccess(
            {
              account_index: accountIndex,
              addresses: {
                ethereum: addresses.ethereum,
                solana: addresses.solana,
              },
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
