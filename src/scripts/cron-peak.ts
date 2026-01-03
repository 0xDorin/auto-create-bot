/**
 * Cron job for Railway - Peak Time Mode
 * - Runs at 21:00 KST (12:00 UTC)
 * - Creates 30 tokens over 4 hours (peak time - more tokens)
 * - Runs once and exits (not a daemon)
 * - Resets state on new day
 */

import { formatEther, parseEther } from 'viem';
import { deriveWallet, getBalance } from '../services/wallet';
import { config } from '../config';
import { runScheduler } from '../services/scheduler';
import { loadState, resetState } from '../services/storage';
import { fetchMonPrice, calculateMonAmount } from '../services/priceOracle';

/**
 * Peak time mode configuration (hardcoded)
 */
const MODE_CONFIG = {
  name: 'peak',
  tokensToCreate: 30,
  durationHours: 4,
  numWallets: parseInt(process.env.NUM_WALLETS || '10'),
};


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
 * Send completion report
 */
async function sendReport(
  startBalance: bigint,
  endBalance: bigint,
  tokensCreated: number
) {
  const spent = startBalance - endBalance;

  console.log('\n' + '='.repeat(80));
  console.log('📊 RUN REPORT');
  console.log('='.repeat(80));
  console.log(`Mode: ${MODE_CONFIG.name}`);
  console.log(`Time: ${new Date().toLocaleString()}`);
  console.log(`Tokens created: ${tokensCreated}`);
  console.log(`Start balance: ${formatEther(startBalance)} MON`);
  console.log(`End balance: ${formatEther(endBalance)} MON`);
  console.log(`Spent: ${formatEther(spent)} MON`);
  console.log(`Cost per token: ${formatEther(spent / BigInt(tokensCreated || 1))} MON`);
  console.log('='.repeat(80) + '\n');

  // TODO: Send to monitoring system
}

/**
 * Calculate absolute end time for peak mode
 * Peak: 21:00 KST today → 01:00 KST tomorrow
 */
function getEndTime(): Date {
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000; // KST = UTC + 9 hours
  const kstNow = new Date(now.getTime() + kstOffset);

  const kstHour = kstNow.getUTCHours();

  // If current time is before 01:00 KST, end time is 01:00 today
  // If current time is 01:00 or after, end time is 01:00 tomorrow
  const endTime = new Date(kstNow);
  endTime.setUTCHours(1, 0, 0, 0);

  if (kstHour >= 1) {
    // Add 1 day
    endTime.setUTCDate(endTime.getUTCDate() + 1);
  }

  // Convert back to UTC
  return new Date(endTime.getTime() - kstOffset);
}

/**
 * Main cron run function
 */
async function main() {
  // Set SERVICE_NAME for separate state file
  process.env.SERVICE_NAME = MODE_CONFIG.name;

  console.log(`\n🤖 CRON:PEAK Started [${config.networkMode}] - 21:00-01:00 KST (30 tokens / 4 hours)`);

  // Check if already past end time
  const endTime = getEndTime();
  const now = new Date();

  if (now >= endTime) {
    console.log('⏰ Past end time (01:00 KST). Skipping.\n');
    process.exit(0);
  }

  const remainingMinutes = Math.floor((endTime.getTime() - now.getTime()) / 60000);
  const remainingHours = remainingMinutes / 60;

  console.log(`⏰ Remaining: ${remainingMinutes}min (${remainingHours.toFixed(2)}h)`);

  try {
    const today = new Date().toISOString().split('T')[0];
    const state = loadState();

    if (state.lastRunDate !== today) {
      console.log(`📅 New day detected, resetting state...`);
      await resetState();
    }

    const priceData = await fetchMonPrice();
    console.log(`💵 MON: $${priceData.price.toFixed(6)}`);

    const adjustedDuration = Math.min(MODE_CONFIG.durationHours, remainingHours);

    const adjustedTokens = Math.round(
      (adjustedDuration / MODE_CONFIG.durationHours) * MODE_CONFIG.tokensToCreate
    );

    console.log(`⚙️  Creating ${adjustedTokens} tokens over ${adjustedDuration.toFixed(2)}h`);

    (config as any).totalTokensToCreate = adjustedTokens;
    (config as any).durationHours = adjustedDuration;
    (config as any).numWallets = MODE_CONFIG.numWallets;

    const masterWallet = deriveWallet(config.mnemonic, 0);
    const startBalance = await getBalance(masterWallet);

    await runScheduler();

    const endBalance = await getBalance(masterWallet);
    const finalState = loadState();
    await sendReport(startBalance, endBalance, finalState.tokensCreated);

    console.log('✅ Completed\n');
    process.exit(0);
  } catch (error) {
    await sendAlert('Peak time cron job failed', {
      mode: MODE_CONFIG.name,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    console.error('\n❌ Peak time cron job failed:', error);
    process.exit(1);
  }
}

main();
