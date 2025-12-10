/**
 * Data storage service (JSON-based)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import type { PreparedToken, PreparedTokensFile } from '../types';

const DATA_DIR = resolve(__dirname, '../../data');
const METADATA_FILE = resolve(DATA_DIR, 'metadata.json');

// Use SERVICE_NAME env var for separate state files per service
const SERVICE_NAME = process.env.SERVICE_NAME || 'default';
const STATE_FILE = resolve(DATA_DIR, `state-${SERVICE_NAME}.json`);

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
 * Save prepared tokens to JSON file (overwrites existing)
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
 * Append new tokens to existing metadata file
 */
export function appendMetadata(newTokens: PreparedToken[]): void {
  ensureDataDir();

  let existingTokens: PreparedToken[] = [];

  // Load existing metadata if file exists
  if (existsSync(METADATA_FILE)) {
    try {
      const content = readFileSync(METADATA_FILE, 'utf-8');
      const data = JSON.parse(content);
      existingTokens = Array.isArray(data) ? data : data.tokens;
      console.log(`Found ${existingTokens.length} existing tokens`);
    } catch (error) {
      console.warn('Could not load existing metadata, starting fresh');
      existingTokens = [];
    }
  }

  // Combine existing and new tokens
  const allTokens = [...existingTokens, ...newTokens];

  // Remove duplicates based on symbol (keep the newest one)
  const uniqueTokens = allTokens.reduce((acc, token) => {
    const existing = acc.find(t => t.symbol === token.symbol);
    if (!existing) {
      acc.push(token);
    }
    // If duplicate, keep the current one (newest)
    return acc;
  }, [] as PreparedToken[]);

  const data: PreparedTokensFile = {
    tokens: uniqueTokens,
    total_count: uniqueTokens.length,
  };

  writeFileSync(METADATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`Added ${newTokens.length} new tokens (${existingTokens.length} → ${uniqueTokens.length} total, ${allTokens.length - uniqueTokens.length} duplicates removed)`);
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
  lastRunDate?: string; // Format: "YYYY-MM-DD"
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
export async function resetState(): Promise<void> {
  const emptyState: BotState = {
    tokensCreated: 0,
    createdTokens: [],
    startTime: undefined,
    lastCreatedAt: undefined,
  };
  await saveState(emptyState);
  console.log('Bot state reset');
}
