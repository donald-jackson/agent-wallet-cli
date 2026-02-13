import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encryptMnemonic, decryptMnemonic, type KdfParams, type CipherParams } from '../security/encryption.js';
import { ensureSecureDir, setFilePermissions, fileExists } from '../security/permissions.js';
import { getKeystoreDir } from './config.js';
import { deriveAddresses } from './mnemonic.js';
import { WalletError, ErrorCodes } from '../output/errors.js';

export interface KeystoreFile {
  version: 1;
  name: string;
  created_at: string;
  kdf: KdfParams;
  cipher: CipherParams;
  addresses: {
    ethereum: string[];
    solana: string[];
  };
  derivation: {
    ethereum_path: string;
    solana_path: string;
  };
}

function getKeystorePath(walletDir: string, name: string): string {
  return join(getKeystoreDir(walletDir), `${name}.json`);
}

/** Check if a keystore with the given name exists. */
export async function keystoreExists(walletDir: string, name: string): Promise<boolean> {
  return fileExists(getKeystorePath(walletDir, name));
}

/** Create a new keystore file from a mnemonic and password. */
export async function createKeystore(
  walletDir: string,
  name: string,
  mnemonic: string,
  password: string,
): Promise<KeystoreFile> {
  const keystoreDir = getKeystoreDir(walletDir);
  await ensureSecureDir(walletDir);
  await ensureSecureDir(keystoreDir);

  const keystorePath = getKeystorePath(walletDir, name);
  if (await fileExists(keystorePath)) {
    throw new WalletError(ErrorCodes.ERR_WALLET_EXISTS, `Wallet "${name}" already exists`);
  }

  const { kdfParams, cipherParams } = await encryptMnemonic(mnemonic, password);
  const addresses = deriveAddresses(mnemonic, 0);

  const keystore: KeystoreFile = {
    version: 1,
    name,
    created_at: new Date().toISOString(),
    kdf: kdfParams,
    cipher: cipherParams,
    addresses: {
      ethereum: [addresses.ethereum],
      solana: [addresses.solana],
    },
    derivation: {
      ethereum_path: "m/44'/60'/0'/0/{i}",
      solana_path: "m/44'/501'/{i}'/0'",
    },
  };

  await writeFile(keystorePath, JSON.stringify(keystore, null, 2));
  await setFilePermissions(keystorePath);

  return keystore;
}

/** Read a keystore file. */
export async function readKeystore(walletDir: string, name: string): Promise<KeystoreFile> {
  const keystorePath = getKeystorePath(walletDir, name);
  if (!(await fileExists(keystorePath))) {
    throw new WalletError(ErrorCodes.ERR_WALLET_NOT_FOUND, `Wallet "${name}" not found`);
  }

  const data = await readFile(keystorePath, 'utf-8');
  return JSON.parse(data) as KeystoreFile;
}

/** Decrypt the mnemonic from a keystore using a password. */
export async function decryptKeystore(walletDir: string, name: string, password: string): Promise<string> {
  const keystore = await readKeystore(walletDir, name);
  try {
    return await decryptMnemonic(keystore.kdf, keystore.cipher, password);
  } catch (error) {
    if (error instanceof Error && (error.message.includes('Unsupported state') || error.message.includes('auth'))) {
      throw new WalletError(ErrorCodes.ERR_WRONG_PASSWORD, 'Incorrect password');
    }
    throw error;
  }
}

/** List all keystore names in the wallet directory. */
export async function listKeystores(walletDir: string): Promise<string[]> {
  const keystoreDir = getKeystoreDir(walletDir);
  if (!(await fileExists(keystoreDir))) return [];

  const { readdir } = await import('node:fs/promises');
  const files = await readdir(keystoreDir);
  return files
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''));
}
