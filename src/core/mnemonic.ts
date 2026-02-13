import * as bip39 from 'bip39';
import { mnemonicToAccount } from 'viem/accounts';
import { derivePath } from 'ed25519-hd-key';
import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import { clearBuffer, clearUint8Array } from '../security/memory.js';

export const ETH_DERIVATION_PATH = "m/44'/60'/0'/0/{i}";
export const SOL_DERIVATION_PATH = "m/44'/501'/{i}'/0'";

/** Generate a new BIP-39 mnemonic. */
export function generateMnemonic(wordCount: 12 | 24 = 12): string {
  const strength = wordCount === 24 ? 256 : 128;
  return bip39.generateMnemonic(strength);
}

/** Validate a BIP-39 mnemonic. */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic);
}

/** Derive an Ethereum address from a mnemonic at the given account index. */
export function deriveEthereumAddress(mnemonic: string, accountIndex = 0): { address: string; } {
  const account = mnemonicToAccount(mnemonic, {
    addressIndex: accountIndex,
  });
  return { address: account.address };
}

/** Derive a Solana keypair from a mnemonic at the given account index. */
export function deriveSolanaKeypair(mnemonic: string, accountIndex = 0): Keypair {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const path = SOL_DERIVATION_PATH.replace('{i}', String(accountIndex));
  const derived = derivePath(path, seed.toString('hex'));
  const keypair = nacl.sign.keyPair.fromSeed(derived.key);
  const solKeypair = Keypair.fromSecretKey(keypair.secretKey);

  // Clear intermediate buffers
  clearBuffer(Buffer.from(seed));
  clearUint8Array(derived.key);

  return solKeypair;
}

/** Derive a Solana address (public key as base58) from a mnemonic. */
export function deriveSolanaAddress(mnemonic: string, accountIndex = 0): { address: string } {
  const keypair = deriveSolanaKeypair(mnemonic, accountIndex);
  const address = keypair.publicKey.toBase58();
  // Clear the secret key
  clearUint8Array(keypair.secretKey);
  return { address };
}

/** Derive addresses for both chains. */
export function deriveAddresses(
  mnemonic: string,
  accountIndex = 0,
): { ethereum: string; solana: string } {
  const eth = deriveEthereumAddress(mnemonic, accountIndex);
  const sol = deriveSolanaAddress(mnemonic, accountIndex);
  return { ethereum: eth.address, solana: sol.address };
}
