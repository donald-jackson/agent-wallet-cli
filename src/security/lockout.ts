import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureSecureDir, setFilePermissions, fileExists } from './permissions.js';
import { WalletError, ErrorCodes } from '../output/errors.js';

const MAX_FAILED_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000; // 1 second
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

interface LockoutRecord {
  failed_attempts: number;
  last_failed_at: string | null;
  locked_until: string | null;
}

function getLockoutDir(walletDir: string): string {
  return join(walletDir, 'lockout');
}

function getLockoutPath(walletDir: string, walletName: string): string {
  return join(getLockoutDir(walletDir), `${walletName}.json`);
}

async function readLockoutRecord(walletDir: string, walletName: string): Promise<LockoutRecord> {
  const path = getLockoutPath(walletDir, walletName);
  if (!(await fileExists(path))) {
    return { failed_attempts: 0, last_failed_at: null, locked_until: null };
  }
  try {
    const data = JSON.parse(await readFile(path, 'utf-8'));
    return {
      failed_attempts: data.failed_attempts ?? 0,
      last_failed_at: data.last_failed_at ?? null,
      locked_until: data.locked_until ?? null,
    };
  } catch {
    return { failed_attempts: 0, last_failed_at: null, locked_until: null };
  }
}

async function writeLockoutRecord(walletDir: string, walletName: string, record: LockoutRecord): Promise<void> {
  const dir = getLockoutDir(walletDir);
  await ensureSecureDir(dir);
  const path = getLockoutPath(walletDir, walletName);
  await writeFile(path, JSON.stringify(record, null, 2));
  await setFilePermissions(path);
}

/**
 * Check if the wallet is currently locked out. Throws ERR_WALLET_LOCKED if so.
 * Returns the current record for use by recordFailedAttempt/recordSuccess.
 */
export async function checkLockout(walletDir: string, walletName: string): Promise<LockoutRecord> {
  const record = await readLockoutRecord(walletDir, walletName);

  if (record.locked_until) {
    const lockedUntil = new Date(record.locked_until);
    const now = new Date();
    if (now < lockedUntil) {
      const remainingSec = Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000);
      const remainingMin = Math.ceil(remainingSec / 60);
      throw new WalletError(
        ErrorCodes.ERR_WALLET_LOCKED,
        `Wallet is locked due to ${record.failed_attempts} consecutive failed attempts. Try again in ${remainingMin} minute${remainingMin === 1 ? '' : 's'}.`,
      );
    }
    // Lockout has expired — reset
    record.failed_attempts = 0;
    record.last_failed_at = null;
    record.locked_until = null;
    await writeLockoutRecord(walletDir, walletName, record);
  }

  // Exponential backoff between attempts (even before full lockout)
  if (record.failed_attempts > 0 && record.last_failed_at) {
    const lastFailed = new Date(record.last_failed_at);
    const backoffMs = BASE_DELAY_MS * Math.pow(2, record.failed_attempts - 1);
    const earliestRetry = new Date(lastFailed.getTime() + backoffMs);
    const now = new Date();
    if (now < earliestRetry) {
      const waitSec = Math.ceil((earliestRetry.getTime() - now.getTime()) / 1000);
      throw new WalletError(
        ErrorCodes.ERR_WALLET_LOCKED,
        `Too many failed attempts. Please wait ${waitSec} second${waitSec === 1 ? '' : 's'} before retrying.`,
      );
    }
  }

  return record;
}

/**
 * Record a failed unlock attempt. Triggers full lockout after MAX_FAILED_ATTEMPTS.
 */
export async function recordFailedAttempt(walletDir: string, walletName: string, record: LockoutRecord): Promise<void> {
  record.failed_attempts += 1;
  record.last_failed_at = new Date().toISOString();

  if (record.failed_attempts >= MAX_FAILED_ATTEMPTS) {
    record.locked_until = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
  }

  await writeLockoutRecord(walletDir, walletName, record);
}

/**
 * Clear the lockout record on successful unlock.
 */
export async function recordSuccess(walletDir: string, walletName: string): Promise<void> {
  const path = getLockoutPath(walletDir, walletName);
  if (await fileExists(path)) {
    const { unlink } = await import('node:fs/promises');
    await unlink(path);
  }
}
