import type { Command } from 'commander';
import { decryptKeystore } from '../core/keystore.js';
import { createSession } from '../core/session.js';
import { outputSuccess, outputError, type OutputFormat } from '../output/formatter.js';
import { WalletError, ErrorCodes } from '../output/errors.js';

export function registerUnlockCommand(program: Command): void {
  program
    .command('unlock')
    .description('Unlock wallet and get session token')
    .option('--password <password>', 'Wallet password')
    .option('--name <name>', 'Wallet name', 'default')
    .option('--duration <seconds>', 'Session duration in seconds (default 3600, max 86400)', '3600')
    .action(async (opts) => {
      const format: OutputFormat = program.opts().format ?? 'json';
      const walletDir: string = program.opts().walletDir;
      const quiet: boolean = program.opts().quiet ?? false;

      try {
        if (!opts.password) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Password is required (--password)');
        }

        const duration = parseInt(opts.duration);
        if (isNaN(duration) || duration <= 0) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Duration must be a positive integer');
        }

        const mnemonic = await decryptKeystore(walletDir, opts.name, opts.password);
        const token = await createSession(walletDir, opts.name, mnemonic, duration);

        outputSuccess(
          {
            token,
            wallet: opts.name,
            expires_in: Math.min(duration, 86400),
          },
          format,
          quiet,
        );
      } catch (error) {
        outputError(error, format, quiet);
      }
    });
}
