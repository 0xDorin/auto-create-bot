/**
 * Token creation scheduler
 */

import { deriveWallets, getBalance, type WalletInstance } from './wallet';
import { loadMetadata, loadState, saveState } from './storage';
import { executeTokenCreation } from './tokenCreator';
import { config } from '../config';
import { TIMING } from '../config/constants';
import type { PreparedToken } from '../types';
import { calculateMonAmount } from './priceOracle';
import { parseEther, formatEther } from 'viem';

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
    if (durationMs === 0) {
      // No duration left - create all tasks immediately
      for (let i = 0; i < totalTokens; i++) {
        const randomMetadataIndex = Math.floor(Math.random() * metadata.length);
        tasks.push({
          tokenIndex: i,
          walletIndex: i % numWallets,
          metadata: metadata[randomMetadataIndex]!,
          delayMs: 0,
          scheduledTime: startTime,
        });
      }
    } else {
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
    }
  } else {
    // Sequential mode: evenly spaced delays with optional randomness
    if (durationMs === 0) {
      // No duration left - create all tasks immediately
      for (let i = 0; i < totalTokens; i++) {
        const randomMetadataIndex = Math.floor(Math.random() * metadata.length);
        tasks.push({
          tokenIndex: i,
          walletIndex: i % numWallets,
          metadata: metadata[randomMetadataIndex]!,
          delayMs: 0,
          scheduledTime: startTime,
        });
      }
    } else {
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
  }

  return tasks;
}

/**
 * Calculate required balance for token creation
 * Returns: (10 MON deploy + initialBuy) + 5 MON gas buffer
 */
async function calculateRequiredBalance(): Promise<bigint> {
  const deployFee = parseEther('10');
  const gasBuffer = parseEther('5');

  let initialBuy: bigint;
  if (config.initialBuyMode === 'dynamic') {
    const monAmount = await calculateMonAmount(config.targetPoints);
    initialBuy = monAmount > 0 ? parseEther(monAmount.toString()) : BigInt(0);
  } else {
    initialBuy = parseEther(config.initialBuyAmount);
  }

  return deployFee + initialBuy + gasBuffer;
}

/**
 * Check if wallet has sufficient balance
 */
async function checkWalletBalance(wallet: WalletInstance, required: bigint): Promise<boolean> {
  const balance = await getBalance(wallet);
  return balance >= required;
}

/**
 * Execute a single token creation task
 * Includes wallet balance check and random wallet retry on insufficient balance
 */
async function executeTask(
  task: TokenTask,
  wallets: WalletInstance[],
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

  // Calculate required balance
  const requiredBalance = await calculateRequiredBalance();

  // Try to find a wallet with sufficient balance
  let selectedWalletIndex = task.walletIndex;
  let selectedWallet = wallets[selectedWalletIndex]!;
  const maxRetries = wallets.length; // Try all wallets once
  const triedWallets = new Set<number>();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Wait for wallet to be available (not locked by another task)
    while (!lockManager.tryAcquire(selectedWalletIndex)) {
      console.log(
        `\n⏳ Token ${task.tokenIndex + 1}: Wallet [${selectedWalletIndex + 1}] is busy, waiting...`
      );
      await new Promise((resolve) => setTimeout(resolve, TIMING.WALLET_LOCK_POLL_INTERVAL));
    }

    try {
      // Check wallet balance
      const hasBalance = await checkWalletBalance(selectedWallet, requiredBalance);

      if (hasBalance) {
        // Sufficient balance - proceed with token creation
        console.log(`\n${'='.repeat(80)}`);
        console.log(`Creating token ${task.tokenIndex + 1}/${config.totalTokensToCreate}: ${task.metadata.symbol}`);
        console.log(`Wallet [${selectedWalletIndex + 1}]: ${selectedWallet.address}`);
        console.log(`Required: ${formatEther(requiredBalance)} MON`);
        console.log(`Scheduled: ${scheduledDate.toLocaleTimeString()}`);
        console.log(`Actual: ${new Date().toLocaleTimeString()}`);
        console.log(`${'='.repeat(80)}`);

        await executeTokenCreation(selectedWallet, task.metadata);

        console.log(`✅ Token ${task.tokenIndex + 1} created successfully!`);

        // Release lock before returning
        lockManager.release(selectedWalletIndex);
        return; // Success - exit function
      } else {
        // Insufficient balance - try another wallet
        const balance = await getBalance(selectedWallet);
        console.log(
          `\n⚠️  Token ${task.tokenIndex + 1}: Wallet [${selectedWalletIndex + 1}] has insufficient balance`
        );
        console.log(`   Current: ${formatEther(balance)} MON`);
        console.log(`   Required: ${formatEther(requiredBalance)} MON`);

        triedWallets.add(selectedWalletIndex);
        lockManager.release(selectedWalletIndex);

        // Find a random wallet we haven't tried yet
        const availableWallets = Array.from(
          { length: wallets.length },
          (_, i) => i
        ).filter((i) => !triedWallets.has(i));

        if (availableWallets.length === 0) {
          throw new Error('All wallets have insufficient balance');
        }

        // Select random wallet from available ones
        selectedWalletIndex = availableWallets[Math.floor(Math.random() * availableWallets.length)]!;
        selectedWallet = wallets[selectedWalletIndex]!;

        console.log(`   Trying random wallet [${selectedWalletIndex + 1}]...`);
        // Loop will continue to try this new wallet
      }
    } catch (error) {
      // Release lock and re-throw
      lockManager.release(selectedWalletIndex);
      throw error;
    }
  }

  // If we get here, all wallets were tried and failed
  // Release the last acquired lock before throwing
  lockManager.release(selectedWalletIndex);
  throw new Error(`Token ${task.tokenIndex + 1}: All ${maxRetries} wallets have insufficient balance`);
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

  if (config.initialBuyMode === 'dynamic') {
    console.log(`Initial buy mode: dynamic (${config.targetPoints} points target)`);
  } else {
    console.log(`Initial buy mode: fixed (${config.initialBuyAmount} MON)`);
  }

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
  const originalEndTime = new Date(state.startTime + durationMs);
  const elapsedTime = Date.now() - state.startTime;
  const remainingDuration = Math.max(0, durationMs - elapsedTime);

  console.log(`\nStart time: ${new Date(state.startTime).toLocaleString()}`);
  console.log(`Original completion time: ${originalEndTime.toLocaleString()}`);
  console.log(`Elapsed time: ${(elapsedTime / 1000 / 60).toFixed(2)} minutes`);
  console.log(`Remaining time: ${(remainingDuration / 1000 / 60).toFixed(2)} minutes`);

  // Generate tasks
  const remainingTokens = config.totalTokensToCreate - state.tokensCreated;
  if (remainingTokens === 0) {
    console.log('\n✅ All tokens have already been created!');
    return;
  }

  console.log(`\n📋 Generating ${remainingTokens} token creation tasks...`);

  // Use remaining duration for restart scenarios
  let effectiveDuration: number;
  let effectiveStartTime: number;

  if (remainingDuration > 0) {
    // Still within original duration - use remaining time
    effectiveDuration = remainingDuration;
    effectiveStartTime = Date.now();
    console.log(`⏱️  Using remaining duration: ${(remainingDuration / 1000 / 60).toFixed(2)} minutes`);
  } else {
    // Original duration has passed - create all remaining tokens immediately
    effectiveDuration = 0;
    effectiveStartTime = Date.now();
    console.log(`⚠️  Original duration has passed. Creating ${remainingTokens} tokens immediately.`);
  }

  const tasks = generateTasks(
    remainingTokens,
    effectiveDuration,
    wallets.length,
    metadata,
    effectiveStartTime
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
      tasks.map((task) => executeTask(task, wallets, lockManager))
    );

    // Count successes and failures
    let successes = 0;
    let failures = 0;

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successes++;
      } else {
        failures++;
        console.error(`\n❌ Task ${index + 1} failed, skipping:`);
        console.error(result.reason instanceof Error ? result.reason.stack || result.reason.message : result.reason);
      }
    });

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
        await executeTask(task, wallets, lockManager);
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
