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
 * Main cron run function
 */
async function main() {
  // Set SERVICE_NAME for separate state file
  process.env.SERVICE_NAME = MODE_CONFIG.name;

  console.log('\n' + '='.repeat(80));
  console.log('🤖 CRON JOB STARTED - PEAK TIME MODE');
  console.log('='.repeat(80));
  console.log(`Time: ${new Date().toLocaleString()}`);
  console.log(`Network: ${config.networkMode}`);
  console.log(`Tokens to create: ${MODE_CONFIG.tokensToCreate}`);
  console.log(`Duration: ${MODE_CONFIG.durationHours} hours (21:00-01:00 KST)`);
  console.log(`Wallets: ${MODE_CONFIG.numWallets}`);
  console.log('='.repeat(80) + '\n');

  try {
    // 1. Check date and reset state if needed
    const today = new Date().toISOString().split('T')[0]; // "2025-01-10"
    const state = loadState();

    if (state.lastRunDate !== today) {
      console.log(`📅 Date Check:`);
      console.log(`  Last run: ${state.lastRunDate || 'Never'}`);
      console.log(`  Today: ${today}`);
      console.log(`  → New day detected, resetting state...\n`);

      await resetState();
    } else {
      console.log(`📅 Date Check: Same day (${today}), keeping existing state\n`);
    }

    // 2. Fetch current MON price
    const priceData = await fetchMonPrice();
    console.log(`💵 MON: $${priceData.price.toFixed(6)}\n`);

    // 3. Override config with mode settings
    (config as any).totalTokensToCreate = MODE_CONFIG.tokensToCreate;
    (config as any).durationHours = MODE_CONFIG.durationHours;
    (config as any).numWallets = MODE_CONFIG.numWallets;

    // 4. Get master wallet for report
    const masterWallet = deriveWallet(config.mnemonic, 0);
    const startBalance = await getBalance(masterWallet);

    // 5. Run scheduler (wallet balance check happens per-token)
    console.log('🚀 Starting token creation...\n');
    console.log('💡 Note: Wallet balance will be checked before each token creation\n');
    await runScheduler();

    // 6. Send report
    const endBalance = await getBalance(masterWallet);
    const finalState = loadState();
    await sendReport(startBalance, endBalance, finalState.tokensCreated);

    console.log('✅ Peak time cron job completed successfully!\n');
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
