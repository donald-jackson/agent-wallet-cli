import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { secureRandom, encryptAesGcm, decryptAesGcm, deriveHkdfKey, hmacSha256, type CipherParams } from '../security/encryption.js';
import { ensureSecureDir, setFilePermissions, fileExists } from '../security/permissions.js';
import { clearBuffer } from '../security/memory.js';
import { getSessionDir } from './config.js';
import { WalletError, ErrorCodes } from '../output/errors.js';

const TOKEN_PREFIX = 'wlt_';
const TOKEN_ID_SIZE = 16;
const TOKEN_SECRET_SIZE = 32;
const HKDF_INFO = 'wallet-cli-session-key';
const DEFAULT_DURATION = 3600; // 1 hour
const MAX_DURATION = 86400; // 24 hours

export interface SessionFile {
  version: 1;
  wallet_name: string;
  token_id: string; // hex
  hmac: string; // hex - HMAC(token_id, token_secret)
  cipher: CipherParams;
  created_at: string;
  expires_at: string;
}

function getSessionPath(walletDir: string, name: string): string {
  return join(getSessionDir(walletDir), `${name}.json`);
}

function getTokenFilePath(walletDir: string, name: string): string {
  return join(getSessionDir(walletDir), `${name}.token`);
}

/** Encode a session token from token_id + token_secret. */
function encodeToken(tokenId: Buffer, tokenSecret: Buffer): string {
  const combined = Buffer.concat([tokenId, tokenSecret]);
  const encoded = combined.toString('base64url');
  clearBuffer(combined);
  return TOKEN_PREFIX + encoded;
}

/** Decode a session token back into token_id + token_secret. */
function decodeToken(token: string): { tokenId: Buffer; tokenSecret: Buffer } {
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new WalletError(ErrorCodes.ERR_SESSION_INVALID, 'Invalid token format');
  }
  const encoded = token.slice(TOKEN_PREFIX.length);
  const combined = Buffer.from(encoded, 'base64url');
  if (combined.length !== TOKEN_ID_SIZE + TOKEN_SECRET_SIZE) {
    throw new WalletError(ErrorCodes.ERR_SESSION_INVALID, 'Invalid token length');
  }
  const tokenId = Buffer.from(combined.subarray(0, TOKEN_ID_SIZE));
  const tokenSecret = Buffer.from(combined.subarray(TOKEN_ID_SIZE));
  clearBuffer(combined);
  return { tokenId, tokenSecret };
}

/** Create a new session token for a wallet. */
export async function createSession(
  walletDir: string,
  walletName: string,
  mnemonic: string,
  duration?: number,
): Promise<string> {
  const sessionDir = getSessionDir(walletDir);
  await ensureSecureDir(sessionDir);

  const actualDuration = Math.min(duration ?? DEFAULT_DURATION, MAX_DURATION);
  const tokenId = secureRandom(TOKEN_ID_SIZE);
  const tokenSecret = secureRandom(TOKEN_SECRET_SIZE);

  // Derive session AES key from token_secret via HKDF
  const salt = secureRandom(32);
  const sessionKey = deriveHkdfKey(tokenSecret, salt, HKDF_INFO);

  // Encrypt mnemonic with session key
  const mnemonicBuf = Buffer.from(mnemonic, 'utf-8');
  const cipher = encryptAesGcm(mnemonicBuf, sessionKey);
  clearBuffer(mnemonicBuf);

  // Compute HMAC for validation
  const hmac = hmacSha256(tokenSecret, tokenId);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + actualDuration * 1000);

  const sessionFile: SessionFile & { hkdf_salt: string } = {
    version: 1,
    wallet_name: walletName,
    token_id: tokenId.toString('hex'),
    hmac: hmac.toString('hex'),
    hkdf_salt: salt.toString('hex'),
    cipher,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };

  const sessionPath = getSessionPath(walletDir, walletName);
  await writeFile(sessionPath, JSON.stringify(sessionFile, null, 2));
  await setFilePermissions(sessionPath);

  // Also write the token to a file for convenience
  const token = encodeToken(tokenId, tokenSecret);
  const tokenPath = getTokenFilePath(walletDir, walletName);
  await writeFile(tokenPath, token);
  await setFilePermissions(tokenPath);

  // Clean up
  clearBuffer(sessionKey);
  clearBuffer(hmac);
  clearBuffer(salt);

  return token;
}

/** Validate a session token and decrypt the mnemonic. */
export async function validateSession(
  walletDir: string,
  walletName: string,
  token: string,
): Promise<string> {
  const sessionPath = getSessionPath(walletDir, walletName);
  if (!(await fileExists(sessionPath))) {
    throw new WalletError(ErrorCodes.ERR_SESSION_NOT_FOUND, 'No active session found');
  }

  const sessionData = JSON.parse(await readFile(sessionPath, 'utf-8')) as SessionFile & { hkdf_salt: string };

  // Check expiry
  const expiresAt = new Date(sessionData.expires_at);
  if (new Date() > expiresAt) {
    // Clean up expired session
    await revokeSession(walletDir, walletName);
    throw new WalletError(ErrorCodes.ERR_SESSION_EXPIRED, 'Session has expired');
  }

  // Decode token
  const { tokenId, tokenSecret } = decodeToken(token);

  try {
    // Validate token_id matches
    if (tokenId.toString('hex') !== sessionData.token_id) {
      throw new WalletError(ErrorCodes.ERR_SESSION_INVALID, 'Invalid session token');
    }

    // Validate HMAC
    const expectedHmac = hmacSha256(tokenSecret, tokenId);
    if (expectedHmac.toString('hex') !== sessionData.hmac) {
      throw new WalletError(ErrorCodes.ERR_SESSION_INVALID, 'Invalid session token');
    }
    clearBuffer(expectedHmac);

    // Derive session key and decrypt mnemonic
    const salt = Buffer.from(sessionData.hkdf_salt, 'hex');
    const sessionKey = deriveHkdfKey(tokenSecret, salt, HKDF_INFO);
    const mnemonicBuf = decryptAesGcm(sessionData.cipher, sessionKey);
    const mnemonic = mnemonicBuf.toString('utf-8');

    clearBuffer(sessionKey);
    clearBuffer(mnemonicBuf);

    return mnemonic;
  } finally {
    clearBuffer(tokenId);
    clearBuffer(tokenSecret);
  }
}

/** Revoke a session (delete session and token files). */
export async function revokeSession(walletDir: string, walletName: string): Promise<void> {
  const sessionPath = getSessionPath(walletDir, walletName);
  const tokenPath = getTokenFilePath(walletDir, walletName);

  if (await fileExists(sessionPath)) {
    await unlink(sessionPath);
  }
  if (await fileExists(tokenPath)) {
    await unlink(tokenPath);
  }
}

/**
 * Resolve the session token from various sources.
 * Priority: explicit --token flag > WALLET_CLI_TOKEN env > session file
 */
export async function resolveToken(walletDir: string, walletName: string, explicitToken?: string): Promise<string> {
  if (explicitToken) return explicitToken;

  const envToken = process.env.WALLET_CLI_TOKEN;
  if (envToken) return envToken;

  const tokenPath = getTokenFilePath(walletDir, walletName);
  if (await fileExists(tokenPath)) {
    return (await readFile(tokenPath, 'utf-8')).trim();
  }

  throw new WalletError(ErrorCodes.ERR_NO_TOKEN, 'No session token provided. Use --token, WALLET_CLI_TOKEN env, or run "wallet-cli unlock" first.');
}
