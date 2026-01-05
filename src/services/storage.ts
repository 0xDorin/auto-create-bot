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
const VOLUME_STATE_FILE = resolve(DATA_DIR, 'volume-state.json');

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

  // Remove duplicates based on tokenURI (keep the first one)
  const uniqueTokens = allTokens.reduce((acc, token) => {
    const existing = acc.find(t => t.tokenURI === token.tokenURI);
    if (!existing) {
      acc.push(token);
    }
    // If duplicate, keep the existing one (first occurrence)
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
 * Volume bot state
 */
export interface VolumeState {
  currentWalletIndex: number;    // Current wallet being processed (0-based)
  currentWalletTrades: number;   // Number of trades completed by current wallet (0-6)
  nextTokenIndex: number;        // Next token index to use from eligible tokens list
  totalCompletedTrades: number;  // Total number of completed trades (lifetime, never resets)
  lastTradeTimestamp?: number;   // Timestamp of last trade (for resuming)
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
  const today = new Date().toISOString().split('T')[0]; // "2025-01-10"
  const emptyState: BotState = {
    tokensCreated: 0,
    createdTokens: [],
    startTime: undefined,
    lastCreatedAt: undefined,
    lastRunDate: today,
  };
  await saveState(emptyState);
  console.log('Bot state reset');
}

/**
 * Load volume bot state
 */
export function loadVolumeState(): VolumeState {
  if (!existsSync(VOLUME_STATE_FILE)) {
    return {
      currentWalletIndex: 0,
      currentWalletTrades: 0,
      nextTokenIndex: 0,
      totalCompletedTrades: 0,
    };
  }

  const content = readFileSync(VOLUME_STATE_FILE, 'utf-8');
  return JSON.parse(content) as VolumeState;
}

/**
 * Save volume bot state (with lock to prevent concurrent writes)
 */
export async function saveVolumeState(state: VolumeState): Promise<void> {
  await stateLock.withLock(() => {
    ensureDataDir();
    writeFileSync(VOLUME_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  });
}

/**
 * Update volume state atomically
 */
export async function updateVolumeState(
  updater: (state: VolumeState) => void | Promise<void>
): Promise<void> {
  await stateLock.withLock(async () => {
    const state = loadVolumeState();
    await updater(state);
    ensureDataDir();
    writeFileSync(VOLUME_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  });
}

/**
 * Reset volume bot state
 */
export async function resetVolumeState(): Promise<void> {
  const emptyState: VolumeState = {
    currentWalletIndex: 0,
    currentWalletTrades: 0,
    nextTokenIndex: 0,
    totalCompletedTrades: 0,
  };
  await saveVolumeState(emptyState);
  console.log('Volume bot state reset');
}

// ============================================================================
// Metadata State (for prepare-metadata script)
// ============================================================================

const METADATA_STATE_FILE = resolve(DATA_DIR, 'metadata-state.json');

/**
 * Metadata preparation state
 */
export interface MetadataState {
  lastPage: number;           // Last successfully processed page
  lastPreparedAt?: number;    // Timestamp of last preparation
  totalPrepared?: number;     // Total tokens prepared (lifetime)
}

/**
 * Load metadata state
 */
export function loadMetadataState(): MetadataState {
  if (!existsSync(METADATA_STATE_FILE)) {
    return {
      lastPage: 0,  // 0 means never run, will start from config or page 1
    };
  }

  const content = readFileSync(METADATA_STATE_FILE, 'utf-8');
  return JSON.parse(content) as MetadataState;
}

/**
 * Save metadata state
 */
export function saveMetadataState(state: MetadataState): void {
  ensureDataDir();
  writeFileSync(METADATA_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Update metadata state after successful preparation
 */
export function updateMetadataState(page: number, tokenCount: number): void {
  const currentState = loadMetadataState();
  const newState: MetadataState = {
    lastPage: page,
    lastPreparedAt: Date.now(),
    totalPrepared: (currentState.totalPrepared || 0) + tokenCount,
  };
  saveMetadataState(newState);
}

/**
 * Reset metadata state (start from page 1)
 */
export function resetMetadataState(): void {
  const emptyState: MetadataState = {
    lastPage: 0,
  };
  saveMetadataState(emptyState);
  console.log('Metadata state reset');
}
