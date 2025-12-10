/**
 * Daily token creation job
 * - Checks balance before running
 * - Resets daily state
 * - Runs scheduler
 * - Sends report
 */

import { formatEther, parseEther } from 'viem';
import { deriveWallet, getBalance } from '../services/wallet';
import { config } from '../config';
import { runScheduler } from '../services/scheduler';
import { loadState, resetState } from '../services/storage';
import { fetchMonPrice, calculateMonAmount } from '../services/priceOracle';

/**
 * Calculate required balance for daily run
 */
async function calculateRequiredBalance(): Promise<bigint> {
  const tokensToCreate = config.totalTokensToCreate;

  // Per token cost:
  // - Deploy fee: 10 MON
  // - Initial buy: depends on mode
  let initialBuyPerToken: bigint;

  if (config.initialBuyMode === 'dynamic') {
    const monAmount = await calculateMonAmount(config.targetPoints);
    initialBuyPerToken = parseEther(monAmount.toString());
  } else {
    initialBuyPerToken = parseEther(config.initialBuyAmount);
  }

  const costPerToken = parseEther('10') + initialBuyPerToken;

  // Total + 10% buffer
  const totalCost = costPerToken * BigInt(tokensToCreate);
  const withBuffer = (totalCost * BigInt(110)) / BigInt(100);

  return withBuffer;
}

/**
 * Send alert (placeholder - implement with your notification system)
 */
async function sendAlert(message: string, details?: any) {
  console.error('\n' + '='.repeat(80));
  console.error('🚨 ALERT');
  console.error('='.repeat(80));
  console.error(message);
  if (details) {
    console.error(JSON.stringify(details, null, 2));
  }
  console.error('='.repeat(80) + '\n');

  // TODO: Implement actual notification
  // - Telegram bot
  // - Discord webhook
  // - Email
  // - Slack
}

/**
 * Send daily report
 */
async function sendReport(
  startBalance: bigint,
  endBalance: bigint,
  tokensCreated: number
) {
  const spent = startBalance - endBalance;

  console.log('\n' + '='.repeat(80));
  console.log('📊 DAILY REPORT');
  console.log('='.repeat(80));
  console.log(`Tokens created: ${tokensCreated}`);
  console.log(`Start balance: ${formatEther(startBalance)} MON`);
  console.log(`End balance: ${formatEther(endBalance)} MON`);
  console.log(`Spent: ${formatEther(spent)} MON`);
  console.log(`Cost per token: ${formatEther(spent / BigInt(tokensCreated || 1))} MON`);
  console.log('='.repeat(80) + '\n');

  // TODO: Send to monitoring system
}

/**
 * Check if we should run based on configured interval
 * Returns null if should run now, otherwise returns milliseconds to wait
 */
function shouldRunNow(): number | null {
  const state = loadState();
  const intervalHours = parseFloat(process.env.DAILY_RUN_INTERVAL_HOURS || '24');
  const intervalMs = intervalHours * 60 * 60 * 1000;

  if (!state.lastCreatedAt) {
    // Never ran before
    return null;
  }

  const timeSinceLastRun = Date.now() - state.lastCreatedAt;

  if (timeSinceLastRun < intervalMs) {
    const remainingMs = intervalMs - timeSinceLastRun;
    return remainingMs;
  }

  return null;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Reset state for new run
 */
async function resetRunState() {
  console.log('🔄 Resetting state...');
  await resetState();
}

/**
 * Execute one run of token creation
 */
async function executeRun(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('🚀 STARTING TOKEN CREATION RUN');
  console.log('='.repeat(80));
  console.log(`Time: ${new Date().toLocaleString()}`);
  console.log(`Network: ${config.networkMode}`);
  console.log('='.repeat(80) + '\n');

  // 1. Fetch current MON price
  const priceData = await fetchMonPrice();
  console.log(`💵 MON: $${priceData.price.toFixed(6)}\n`);

  // 2. Check master wallet balance
  const masterWallet = deriveWallet(config.mnemonic, 0);
  const startBalance = await getBalance(masterWallet);
  const requiredBalance = await calculateRequiredBalance();

  console.log('💰 Balance Check:');
  console.log(`  Current: ${formatEther(startBalance)} MON`);
  console.log(`  Required: ${formatEther(requiredBalance)} MON`);

  if (startBalance < requiredBalance) {
    await sendAlert('Insufficient balance for run', {
      current: formatEther(startBalance),
      required: formatEther(requiredBalance),
      shortfall: formatEther(requiredBalance - startBalance),
    });
    throw new Error('Insufficient balance');
  }

  console.log('  ✅ Sufficient balance\n');

  // 3. Reset state
  resetRunState();

  // 4. Run scheduler
  console.log('🚀 Starting token creation...\n');
  await runScheduler();

  // 5. Send report
  const endBalance = await getBalance(masterWallet);
  const state = loadState();
  await sendReport(startBalance, endBalance, state.tokensCreated);

  console.log('\n✅ Run completed successfully!\n');
}

/**
 * Main daemon function - runs continuously
 */
async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🤖 DAILY TOKEN CREATION DAEMON STARTED');
  console.log('='.repeat(80));
  console.log(`Time: ${new Date().toLocaleString()}`);
  console.log(`Network: ${config.networkMode}`);
  console.log(`Interval: ${process.env.DAILY_RUN_INTERVAL_HOURS || '24'} hours`);
  console.log('='.repeat(80) + '\n');

  // Setup graceful shutdown
  let isShuttingDown = false;
  const shutdown = () => {
    if (!isShuttingDown) {
      isShuttingDown = true;
      console.log('\n\n🛑 Shutdown signal received. Exiting gracefully...\n');
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Main loop
  while (!isShuttingDown) {
    try {
      const waitMs = shouldRunNow();

      if (waitMs === null) {
        // Ready to run
        await executeRun();
      } else {
        // Need to wait
        const intervalHours = parseFloat(process.env.DAILY_RUN_INTERVAL_HOURS || '24');
        const state = loadState();
        const waitHours = (waitMs / 1000 / 60 / 60).toFixed(1);

        console.log(`⏰ Last run: ${new Date(state.lastCreatedAt!).toLocaleString()}`);
        console.log(`⏰ Next run in: ${waitHours} hours (interval: ${intervalHours}h)`);
        console.log(`⏰ Waiting...\n`);

        // Sleep in 1-minute intervals to allow for graceful shutdown
        const checkIntervalMs = 60 * 1000; // Check every minute
        let remainingMs = waitMs;

        while (remainingMs > 0 && !isShuttingDown) {
          const sleepMs = Math.min(remainingMs, checkIntervalMs);
          await sleep(sleepMs);
          remainingMs -= sleepMs;
        }
      }
    } catch (error) {
      await sendAlert('Run failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      console.error('\n❌ Run failed:', error);
      console.log('\n⏰ Will retry at next interval...\n');

      // Wait for the configured interval before retrying
      const intervalHours = parseFloat(process.env.DAILY_RUN_INTERVAL_HOURS || '24');
      const retryMs = intervalHours * 60 * 60 * 1000;
      const retryHours = intervalHours.toFixed(1);

      console.log(`⏰ Retrying in: ${retryHours} hours\n`);

      // Sleep in 1-minute intervals
      const checkIntervalMs = 60 * 1000;
      let remainingMs = retryMs;

      while (remainingMs > 0 && !isShuttingDown) {
        const sleepMs = Math.min(remainingMs, checkIntervalMs);
        await sleep(sleepMs);
        remainingMs -= sleepMs;
      }
    }
  }
}

main();
