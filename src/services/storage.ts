/**
 * Data storage service (JSON-based)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import type { PreparedToken, PreparedTokensFile } from '../types';

const DATA_DIR = resolve(__dirname, '../../data');
const METADATA_FILE = resolve(DATA_DIR, 'metadata.json');
const STATE_FILE = resolve(DATA_DIR, 'state.json');

/**
 * State lock manager to prevent concurrent state modifications
 */
class StateLockManager {
  private locked: boolean = false;
  private queue: Array<() => void> = [];

  /**
   * Acquire lock (waits if locked)
   */
  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    // Wait for lock to be released
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  /**
   * Release lock and process queue
   */
  release(): void {
    const next = this.queue.shift();
    if (next) {
      // Pass lock to next in queue
      next();
    } else {
      // No one waiting, unlock
      this.locked = false;
    }
  }

  /**
   * Execute function with lock
   */
  async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// Global state lock instance
const stateLock = new StateLockManager();

/**
 * Ensure data directory exists
 */
function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Save prepared tokens to JSON file
 */
export function saveMetadata(tokens: PreparedToken[]): void {
  ensureDataDir();
  const data: PreparedTokensFile = {
    tokens,
    total_count: tokens.length,
  };
  writeFileSync(METADATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`Saved ${tokens.length} tokens to ${METADATA_FILE}`);
}

/**
 * Load prepared tokens from JSON file
 */
export function loadMetadata(): PreparedToken[] {
  if (!existsSync(METADATA_FILE)) {
    throw new Error(
      `Metadata file not found: ${METADATA_FILE}\n` +
        'Run "npm run prepare-metadata" first to generate metadata.'
    );
  }

  const content = readFileSync(METADATA_FILE, 'utf-8');
  const data = JSON.parse(content);

  // Support both old format (array) and new format (object with tokens + total_count)
  const tokens = Array.isArray(data) ? data : data.tokens;

  console.log(`Loaded ${tokens.length} tokens from ${METADATA_FILE}`);
  return tokens;
}

/**
 * Bot state
 */
export interface BotState {
  tokensCreated: number;
  startTime?: number;
  lastCreatedAt?: number;
  createdTokens: Array<{
    tokenAddress: string;
    metadata: PreparedToken;
    createdAt: number;
    walletIndex: number;
  }>;
}

/**
 * Load bot state
 */
export function loadState(): BotState {
  if (!existsSync(STATE_FILE)) {
    return {
      tokensCreated: 0,
      createdTokens: [],
    };
  }

  const content = readFileSync(STATE_FILE, 'utf-8');
  return JSON.parse(content) as BotState;
}

/**
 * Save bot state (with lock to prevent concurrent writes)
 */
export async function saveState(state: BotState): Promise<void> {
  await stateLock.withLock(() => {
    ensureDataDir();
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  });
}

/**
 * Update state atomically with a function
 * Useful for concurrent modifications like incrementing counters
 */
export async function updateState(
  updater: (state: BotState) => void | Promise<void>
): Promise<void> {
  await stateLock.withLock(async () => {
    const state = loadState();
    await updater(state);
    ensureDataDir();
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  });
}

/**
 * Reset bot state
 */
export function resetState(): void {
  const emptyState: BotState = {
    tokensCreated: 0,
    createdTokens: [],
  };
  saveState(emptyState);
  console.log('Bot state reset');
}
