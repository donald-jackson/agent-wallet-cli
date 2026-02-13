import type { Command } from 'commander';
import { decryptKeystore } from '../core/keystore.js';
import { outputSuccess, outputError, type OutputFormat } from '../output/formatter.js';
import { WalletError, ErrorCodes } from '../output/errors.js';
import { readSecretFromStdin, warnCliArgSecret } from '../security/input.js';
import { checkLockout, recordFailedAttempt, recordSuccess } from '../security/lockout.js';

export function registerExportCommand(program: Command): void {
  program
    .command('export')
    .description('Export mnemonic (requires password, not just session token)')
    .option('--password <password>', 'Wallet password (omit to be prompted securely)')
    .option('--name <name>', 'Wallet name', 'default')
    .option('--confirm', 'Confirm export (required)')
    .action(async (opts) => {
      const format: OutputFormat = program.opts().format ?? 'json';
      const walletDir: string = program.opts().walletDir;
      const quiet: boolean = program.opts().quiet ?? false;

      try {
        if (!opts.confirm) {
          throw new WalletError(
            ErrorCodes.ERR_EXPORT_NOT_CONFIRMED,
            'Export requires --confirm flag. This will display your mnemonic phrase.',
          );
        }

        let password: string;
        if (opts.password) {
          warnCliArgSecret('password');
          password = opts.password;
        } else {
          password = await readSecretFromStdin('Enter wallet password: ');
        }

        if (!password) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Password is required');
        }

        // Check lockout before attempting decryption
        const lockoutRecord = await checkLockout(walletDir, opts.name);

        let mnemonic: string;
        try {
          mnemonic = await decryptKeystore(walletDir, opts.name, password);
        } catch (error) {
          if (error instanceof WalletError && error.code === ErrorCodes.ERR_WRONG_PASSWORD) {
            await recordFailedAttempt(walletDir, opts.name, lockoutRecord);
          }
          throw error;
        }

        await recordSuccess(walletDir, opts.name);

        outputSuccess(
          {
            name: opts.name,
            mnemonic,
            warning: 'Keep your mnemonic safe. Anyone with access to it can control your funds.',
          },
          format,
          quiet,
        );
      } catch (error) {
        outputError(error, format, quiet);
      }
    });
}
