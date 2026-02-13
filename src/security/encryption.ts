import { randomBytes, createCipheriv, createDecipheriv, createHmac, hkdfSync } from 'node:crypto';
import argon2 from 'argon2';
import { clearBuffer } from './memory.js';

export interface KdfParams {
  algorithm: 'argon2id';
  time_cost: number;
  memory_cost: number; // in KiB
  parallelism: number;
  salt: string; // hex
}

export interface CipherParams {
  algorithm: 'aes-256-gcm';
  iv: string; // hex, 12 bytes
  auth_tag: string; // hex, 16 bytes
  ciphertext: string; // hex
}

const DEFAULT_KDF_PARAMS: Omit<KdfParams, 'salt'> = {
  algorithm: 'argon2id',
  time_cost: 6,
  memory_cost: 65536, // 64 MB
  parallelism: 4,
};

/** Derive a 256-bit key from a password using Argon2id. */
export async function deriveKeyFromPassword(
  password: string,
  salt?: Buffer,
  params?: Partial<Omit<KdfParams, 'salt' | 'algorithm'>>,
): Promise<{ key: Buffer; kdfParams: KdfParams }> {
  const actualSalt = salt ?? randomBytes(32);
  const timeCost = params?.time_cost ?? DEFAULT_KDF_PARAMS.time_cost;
  const memoryCost = params?.memory_cost ?? DEFAULT_KDF_PARAMS.memory_cost;
  const parallelism = params?.parallelism ?? DEFAULT_KDF_PARAMS.parallelism;

  const key = await argon2.hash(password, {
    type: argon2.argon2id,
    salt: actualSalt,
    timeCost,
    memoryCost,
    parallelism,
    hashLength: 32,
    raw: true,
  });

  const keyBuffer = Buffer.from(key);

  return {
    key: keyBuffer,
    kdfParams: {
      algorithm: 'argon2id',
      time_cost: timeCost,
      memory_cost: memoryCost,
      parallelism: parallelism,
      salt: actualSalt.toString('hex'),
    },
  };
}

/** Encrypt plaintext with AES-256-GCM. */
export function encryptAesGcm(plaintext: Buffer, key: Buffer): CipherParams {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    algorithm: 'aes-256-gcm',
    iv: iv.toString('hex'),
    auth_tag: authTag.toString('hex'),
    ciphertext: encrypted.toString('hex'),
  };
}

/** Decrypt AES-256-GCM ciphertext. */
export function decryptAesGcm(cipher: CipherParams, key: Buffer): Buffer {
  const iv = Buffer.from(cipher.iv, 'hex');
  const authTag = Buffer.from(cipher.auth_tag, 'hex');
  const ciphertext = Buffer.from(cipher.ciphertext, 'hex');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted;
}

/** Encrypt a mnemonic string with a password. Returns KDF and cipher params. */
export async function encryptMnemonic(
  mnemonic: string,
  password: string,
): Promise<{ kdfParams: KdfParams; cipherParams: CipherParams }> {
  const { key, kdfParams } = await deriveKeyFromPassword(password);
  try {
    const cipherParams = encryptAesGcm(Buffer.from(mnemonic, 'utf-8'), key);
    return { kdfParams, cipherParams };
  } finally {
    clearBuffer(key);
  }
}

/** Decrypt a mnemonic from its encrypted form. Returns the mnemonic string. */
export async function decryptMnemonic(
  kdfParams: KdfParams,
  cipherParams: CipherParams,
  password: string,
): Promise<string> {
  const salt = Buffer.from(kdfParams.salt, 'hex');
  const { key } = await deriveKeyFromPassword(password, salt, {
    time_cost: kdfParams.time_cost,
    memory_cost: kdfParams.memory_cost,
    parallelism: kdfParams.parallelism,
  });
  try {
    const plaintext = decryptAesGcm(cipherParams, key);
    return plaintext.toString('utf-8');
  } finally {
    clearBuffer(key);
  }
}

/** Derive a key using HKDF-SHA256. */
export function deriveHkdfKey(ikm: Buffer, salt: Buffer, info: string, length = 32): Buffer {
  const derived = hkdfSync('sha256', ikm, salt, info, length);
  return Buffer.from(derived);
}

/** Compute HMAC-SHA256. */
export function hmacSha256(key: Buffer, data: Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** Generate cryptographically secure random bytes. */
export function secureRandom(size: number): Buffer {
  return randomBytes(size);
}
