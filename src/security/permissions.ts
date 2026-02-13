import { mkdir, chmod, stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { platform } from 'node:os';

const isWindows = platform() === 'win32';

/** Ensure a directory exists with 0700 permissions. */
export async function ensureSecureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
  if (!isWindows) {
    await chmod(dirPath, 0o700);
  }
}

/** Set file permissions to 0600 (owner read/write only). */
export async function setFilePermissions(filePath: string): Promise<void> {
  if (!isWindows) {
    await chmod(filePath, 0o600);
  }
}

/** Check that a file has secure permissions (0600 or stricter). */
export async function checkFilePermissions(filePath: string): Promise<boolean> {
  if (isWindows) return true; // Best-effort on Windows
  try {
    const stats = await stat(filePath);
    const mode = stats.mode & 0o777;
    // Allow 0600 or stricter
    return (mode & 0o077) === 0;
  } catch {
    return false;
  }
}

/** Check if a file exists and is accessible. */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
