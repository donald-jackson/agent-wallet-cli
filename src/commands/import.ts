import type { Command } from 'commander';
import { validateMnemonic, deriveAddresses } from '../core/mnemonic.js';
import { createKeystore } from '../core/keystore.js';
import { outputSuccess, outputError, type OutputFormat } from '../output/formatter.js';
import { WalletError, ErrorCodes } from '../output/errors.js';
import { readSecretFromStdin, readLineFromStdin, warnCliArgSecret } from '../security/input.js';
import { validatePasswordStrength } from '../security/password.js';

export function registerImportCommand(program: Command): void {
  program
    .command('import')
    .description('Import wallet from mnemonic')
    .option('--password <password>', 'Encryption password (omit to be prompted securely)')
    .option('--mnemonic <mnemonic>', 'BIP-39 mnemonic phrase (omit to be prompted securely)')
    .option('--name <name>', 'Wallet name', 'default')
    .action(async (opts) => {
      const format: OutputFormat = program.opts().format ?? 'json';
      const walletDir: string = program.opts().walletDir;
      const quiet: boolean = program.opts().quiet ?? false;

      try {
        let password: string;
        if (opts.password) {
          warnCliArgSecret('password');
          password = opts.password;
        } else {
          password = await readSecretFromStdin('Enter encryption password: ');
          const confirm = await readSecretFromStdin('Confirm encryption password: ');
          if (password !== confirm) {
            throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Passwords do not match');
          }
        }

        if (!password) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Password is required');
        }

        validatePasswordStrength(password);

        let mnemonic: string;
        if (opts.mnemonic) {
          warnCliArgSecret('mnemonic');
          mnemonic = opts.mnemonic.trim();
        } else {
          mnemonic = await readLineFromStdin('Enter BIP-39 mnemonic phrase: ');
        }

        if (!mnemonic) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Mnemonic is required');
        }

        if (!validateMnemonic(mnemonic)) {
          throw new WalletError(ErrorCodes.ERR_INVALID_MNEMONIC, 'Invalid BIP-39 mnemonic');
        }

        const keystore = await createKeystore(walletDir, opts.name, mnemonic, password);
        const addresses = deriveAddresses(mnemonic, 0);

        outputSuccess(
          {
            name: keystore.name,
            addresses: {
              ethereum: addresses.ethereum,
              solana: addresses.solana,
            },
          },
          format,
          quiet,
        );
      } catch (error) {
        outputError(error, format, quiet);
      }
    });
}
