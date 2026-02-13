import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';
import { generateMnemonic, validateMnemonic, deriveAddresses } from '../core/mnemonic.js';
import { createKeystore } from '../core/keystore.js';
import { outputSuccess, outputError, type OutputFormat } from '../output/formatter.js';
import { WalletError, ErrorCodes } from '../output/errors.js';
import { clearBuffer } from '../security/memory.js';
import { readSecretFromStdin, warnCliArgSecret } from '../security/input.js';
import { validatePasswordStrength } from '../security/password.js';
import { setFilePermissions } from '../security/permissions.js';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Create a new wallet')
    .option('--password <password>', 'Encryption password (omit to be prompted securely)')
    .option('--word-count <count>', 'Mnemonic word count (12 or 24)', '12')
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

        const wordCount = parseInt(opts.wordCount) as 12 | 24;
        if (wordCount !== 12 && wordCount !== 24) {
          throw new WalletError(ErrorCodes.ERR_INVALID_INPUT, 'Word count must be 12 or 24');
        }

        const mnemonic = generateMnemonic(wordCount);
        const keystore = await createKeystore(walletDir, opts.name, mnemonic, password);
        const addresses = deriveAddresses(mnemonic, 0);

        // Write mnemonic to a secure file instead of stdout
        const mnemonicFilePath = join(walletDir, `${opts.name}.mnemonic`);
        await writeFile(mnemonicFilePath, mnemonic + '\n', { mode: 0o600 });
        await setFilePermissions(mnemonicFilePath);

        outputSuccess(
          {
            name: keystore.name,
            addresses: {
              ethereum: addresses.ethereum,
              solana: addresses.solana,
            },
            mnemonic_file: mnemonicFilePath,
            warning: 'Your mnemonic has been written to the file above. Read it, back it up securely, then delete the file.',
          },
          format,
          quiet,
        );
      } catch (error) {
        outputError(error, format, quiet);
      }
    });
}
