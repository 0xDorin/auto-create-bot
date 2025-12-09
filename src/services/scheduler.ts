/**
 * Token creation scheduler
 */

import { deriveWallets, type WalletInstance } from './wallet';
import { loadMetadata, loadState, saveState } from './storage';
import { executeTokenCreation } from './tokenCreator';
import { config } from '../config';
import { TIMING } from '../config/constants';
import type { PreparedToken } from '../types';

/**
 * Token creation task
 */
interface TokenTask {
  tokenIndex: number;
  walletIndex: number;
  metadata: PreparedToken;
  delayMs: number;
  scheduledTime: number;
}

/**
 * Wallet lock manager to prevent nonce conflicts
 */
class WalletLockManager {
  private locks: Map<number, boolean> = new Map();

  /**
   * Try to acquire lock for a wallet
   * Returns true if acquired, false if already locked
   */
  tryAcquire(walletIndex: number): boolean {
    if (this.locks.get(walletIndex)) {
      return false; // Already locked
    }
    this.locks.set(walletIndex, true);
    return true;
  }

  /**
   * Release lock for a wallet
   */
  release(walletIndex: number): void {
    this.locks.set(walletIndex, false);
  }

  /**
   * Check if wallet is locked
   */
  isLocked(walletIndex: number): boolean {
    return this.locks.get(walletIndex) || false;
  }
}

/**
 * Calculate random delay with given average and randomness
 */
function getRandomDelay(averageMs: number, randomness: number): number {
  const min = averageMs * (1 - randomness);
  const max = averageMs * (1 + randomness);
  return Math.floor(Math.random() * (max - min) + min);
}

/**
 * Generate all token creation tasks with delays
 */
function generateTasks(
  totalTokens: number,
  durationMs: number,
  numWallets: number,
  metadata: PreparedToken[],
  startTime: number
): TokenTask[] {
  const tasks: TokenTask[] = [];
  const averageDelay = durationMs / totalTokens;

  if (config.executionMode === 'parallel') {
    // Parallel mode: assign random execution times distributed across duration
    // Create array of random times within the duration window
    const randomTimes: number[] = [];
    for (let i = 0; i < totalTokens; i++) {
      // Generate random time within [0, durationMs]
      const randomTime = Math.random() * durationMs;
      randomTimes.push(randomTime);
    }

    // Sort times to maintain some order (optional, but helps with visualization)
    randomTimes.sort((a, b) => a - b);

    for (let i = 0; i < totalTokens; i++) {
      // Select random metadata
      const randomMetadataIndex = Math.floor(Math.random() * metadata.length);

      tasks.push({
        tokenIndex: i,
        walletIndex: i % numWallets,
        metadata: metadata[randomMetadataIndex]!,
        delayMs: randomTimes[i]!,
        scheduledTime: startTime + randomTimes[i]!,
      });
    }
  } else {
    // Sequential mode: evenly spaced delays with optional randomness
    for (let i = 0; i < totalTokens; i++) {
      const baseDelay = i * averageDelay;
      const delay = config.delayRandomness > 0
        ? getRandomDelay(baseDelay, config.delayRandomness)
        : baseDelay;

      // Select random metadata
      const randomMetadataIndex = Math.floor(Math.random() * metadata.length);

      tasks.push({
        tokenIndex: i,
        walletIndex: i % numWallets,
        metadata: metadata[randomMetadataIndex]!,
        delayMs: delay,
        scheduledTime: startTime + delay,
      });
    }
  }

  return tasks;
}

/**
 * Execute a single token creation task
 */
async function executeTask(
  task: TokenTask,
  wallet: WalletInstance,
  lockManager: WalletLockManager
): Promise<void> {
  const scheduledDate = new Date(task.scheduledTime);
  const now = Date.now();
  const waitTime = Math.max(0, task.scheduledTime - now);

  if (waitTime > 0) {
    console.log(
      `\n⏰ Token ${task.tokenIndex + 1} scheduled at ${scheduledDate.toLocaleTimeString()}`
    );
    console.log(`   Waiting ${(waitTime / 1000 / 60).toFixed(2)} minutes...`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }

  // Wait for wallet to be available (not locked by another task)
  while (!lockManager.tryAcquire(task.walletIndex)) {
    console.log(
      `\n⏳ Token ${task.tokenIndex + 1}: Wallet [${task.walletIndex + 1}] is busy, waiting...`
    );
    await new Promise((resolve) => setTimeout(resolve, TIMING.WALLET_LOCK_POLL_INTERVAL));
  }

  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Creating token ${task.tokenIndex + 1}/${config.totalTokensToCreate}: ${task.metadata.symbol}`);
    console.log(`Wallet [${task.walletIndex + 1}]: ${wallet.address}`);
    console.log(`Scheduled: ${scheduledDate.toLocaleTimeString()}`);
    console.log(`Actual: ${new Date().toLocaleTimeString()}`);
    console.log(`${'='.repeat(80)}`);

    await executeTokenCreation(wallet, task.metadata);

    console.log(`✅ Token ${task.tokenIndex + 1} created successfully!`);
  } finally {
    // Always release the lock, even if execution failed
    lockManager.release(task.walletIndex);
  }
}

/**
 * Run the bot scheduler
 */
export async function runScheduler(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('TOKEN CREATION BOT STARTED');
  console.log('='.repeat(80));
  console.log(`\nNetwork: ${config.networkMode}`);
  console.log(`Total tokens to create: ${config.totalTokensToCreate}`);
  console.log(`Duration: ${config.durationHours} hours`);
  console.log(`Number of wallets: ${config.numWallets}`);
  console.log(`Execution mode: ${config.executionMode}`);
  console.log(`Delay randomness: ${(config.delayRandomness * 100).toFixed(0)}%`);
  console.log(`Initial buy amount: ${config.initialBuyAmount} MON`);
  console.log(`Sell percentage: ${config.sellPercentage}%`);

  // Load metadata
  const metadata = loadMetadata();

  if (metadata.length === 0) {
    throw new Error(
      `No metadata available. Run "npm run prepare-metadata" to prepare tokens.`
    );
  }

  console.log(`\nMetadata loaded: ${metadata.length} entries (will be randomly selected)`);
  metadata.forEach((m, i) => {
    console.log(`  [${i + 1}] ${m.symbol}`);
  });

  // Load state
  const state = loadState();

  // Derive wallets (skip index 0 which is master wallet)
  const wallets = deriveWallets(config.mnemonic, config.numWallets + 1).slice(1);

  console.log(`\nWallets loaded: ${wallets.length}`);
  wallets.forEach((w, i) => {
    console.log(`  [${i + 1}] ${w.address}`);
  });

  // Set start time if not already set
  if (!state.startTime) {
    state.startTime = Date.now();
    await saveState(state);
  }

  const durationMs = config.durationHours * 60 * 60 * 1000;
  const estimatedEndTime = new Date(state.startTime + durationMs);

  console.log(`\nStart time: ${new Date(state.startTime).toLocaleString()}`);
  console.log(`Estimated completion: ${estimatedEndTime.toLocaleString()}`);

  // Generate tasks
  const remainingTokens = config.totalTokensToCreate - state.tokensCreated;
  if (remainingTokens === 0) {
    console.log('\n✅ All tokens have already been created!');
    return;
  }

  console.log(`\n📋 Generating ${remainingTokens} token creation tasks...`);
  const tasks = generateTasks(
    remainingTokens,
    durationMs,
    wallets.length,
    metadata,
    state.startTime
  );

  // Sort tasks by scheduled time for display
  const sortedTasks = [...tasks].sort((a, b) => a.scheduledTime - b.scheduledTime);
  console.log(`\n📅 Token creation schedule:`);
  sortedTasks.slice(0, 10).forEach((task) => {
    const time = new Date(task.scheduledTime).toLocaleTimeString();
    console.log(
      `  ${task.tokenIndex + 1}. ${task.metadata.symbol.padEnd(10)} at ${time} (Wallet ${task.walletIndex + 1})`
    );
  });
  if (sortedTasks.length > 10) {
    console.log(`  ... and ${sortedTasks.length - 10} more`);
  }

  console.log('\n' + '='.repeat(80));
  console.log(`🚀 Starting ${config.executionMode} execution...`);
  console.log('='.repeat(80) + '\n');

  // Create wallet lock manager
  const lockManager = new WalletLockManager();

  // Execute based on mode
  if (config.executionMode === 'parallel') {
    // Parallel execution (no retry, skip failures)
    const results = await Promise.allSettled(
      tasks.map((task) =>
        executeTask(task, wallets[task.walletIndex]!, lockManager).catch((error) => {
          console.error(`\n❌ Task ${task.tokenIndex + 1} failed, skipping:`);
          console.error(error instanceof Error ? error.stack || error.message : error);
          // Don't throw, just skip this token
        })
      )
    );

    // Count successes and failures
    const successes = results.filter((r) => r.status === 'fulfilled').length;
    const failures = results.filter((r) => r.status === 'rejected').length;

    console.log('\n' + '='.repeat(80));
    console.log('📊 EXECUTION SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total tasks: ${results.length}`);
    console.log(`✅ Successful: ${successes}`);
    console.log(`❌ Failed: ${failures}`);
  } else {
    // Sequential execution (skip failures, continue)
    for (const task of sortedTasks) {
      try {
        await executeTask(task, wallets[task.walletIndex]!, lockManager);
      } catch (error) {
        console.error(`\n❌ Token ${task.tokenIndex + 1} failed, skipping:`);
        console.error(error instanceof Error ? error.stack || error.message : error);
        // Continue to next token instead of stopping
      }
    }
  }

  // Completion
  const totalTime = Date.now() - state.startTime!;
  const totalHours = (totalTime / 1000 / 60 / 60).toFixed(2);

  console.log('\n' + '='.repeat(80));
  console.log('✅ BOT COMPLETED SUCCESSFULLY!');
  console.log('='.repeat(80));
  console.log(`\nTokens created: ${state.tokensCreated}/${config.totalTokensToCreate}`);
  console.log(`Total time: ${totalHours} hours`);
  console.log(`\nCreated tokens:`);

  state.createdTokens.forEach((token, i) => {
    console.log(`  [${i + 1}] ${token.metadata.symbol}: ${token.tokenAddress}`);
  });

  console.log('\n' + '='.repeat(80) + '\n');
}
