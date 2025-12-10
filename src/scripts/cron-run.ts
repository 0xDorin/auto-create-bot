/**
 * Cron job for Railway
 * - Runs once and exits (not a daemon)
 * - Resets state before each run
 * - Uses MODE env var to determine configuration (evening or night)
 * - Evening (21:00): 30 tokens, 4 hours
 * - Night (01:30): 20 tokens, 19.5 hours
 */

import { formatEther, parseEther } from 'viem';
import { deriveWallet, getBalance } from '../services/wallet';
import { config } from '../config';
import { runScheduler } from '../services/scheduler';
import { resetState, loadState } from '../services/storage';
import { fetchMonPrice, calculateMonAmount } from '../services/priceOracle';

/**
 * Mode configuration
 */
interface ModeConfig {
  name: string;
  tokensToCreate: number;
  durationHours: number;
  numWallets: number;
}

/**
 * Get mode configuration from MODE env var
 */
function getModeConfig(): ModeConfig {
  const mode = process.env.MODE || 'evening';

  if (mode === 'evening') {
    // Evening: 21:00-01:00 KST (4 hours, 30 tokens)
    return {
      name: 'evening',
      tokensToCreate: 30,
      durationHours: 4,
      numWallets: parseInt(process.env.NUM_WALLETS || '10'),
    };
  } else if (mode === 'night') {
    // Night: 01:00-16:00 KST (15 hours, 20 tokens)
    return {
      name: 'night',
      tokensToCreate: 20,
      durationHours: 15,
      numWallets: parseInt(process.env.NUM_WALLETS || '10'),
    };
  } else {
    throw new Error(`Invalid MODE: ${mode}. Must be 'evening' or 'night'`);
  }
}

/**
 * Calculate required balance for this run
 */
async function calculateRequiredBalance(tokensToCreate: number): Promise<bigint> {

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
 * Send completion report
 */
async function sendReport(
  startBalance: bigint,
  endBalance: bigint,
  tokensCreated: number
) {
  const spent = startBalance - endBalance;
  const serviceName = process.env.SERVICE_NAME || 'default';

  console.log('\n' + '='.repeat(80));
  console.log('📊 RUN REPORT');
  console.log('='.repeat(80));
  console.log(`Service: ${serviceName}`);
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
  // Get mode configuration
  const modeConfig = getModeConfig();

  // Set SERVICE_NAME based on mode for separate state files
  process.env.SERVICE_NAME = modeConfig.name;

  console.log('\n' + '='.repeat(80));
  console.log('🤖 CRON JOB STARTED');
  console.log('='.repeat(80));
  console.log(`Mode: ${modeConfig.name}`);
  console.log(`Time: ${new Date().toLocaleString()}`);
  console.log(`Network: ${config.networkMode}`);
  console.log(`Tokens to create: ${modeConfig.tokensToCreate}`);
  console.log(`Duration: ${modeConfig.durationHours} hours`);
  console.log(`Wallets: ${modeConfig.numWallets}`);
  console.log('='.repeat(80) + '\n');

  try {
    // 1. Fetch current MON price
    const priceData = await fetchMonPrice();
    console.log(`💵 MON: $${priceData.price.toFixed(6)}\n`);

    // 2. Check master wallet balance
    const masterWallet = deriveWallet(config.mnemonic, 0);
    const startBalance = await getBalance(masterWallet);
    const requiredBalance = await calculateRequiredBalance(modeConfig.tokensToCreate);

    console.log('💰 Balance Check:');
    console.log(`  Current: ${formatEther(startBalance)} MON`);
    console.log(`  Required: ${formatEther(requiredBalance)} MON`);

    if (startBalance < requiredBalance) {
      await sendAlert('Insufficient balance for cron run', {
        mode: modeConfig.name,
        current: formatEther(startBalance),
        required: formatEther(requiredBalance),
        shortfall: formatEther(requiredBalance - startBalance),
      });
      console.log('\n❌ Insufficient balance. Aborting.\n');
      process.exit(1);
    }

    console.log('  ✅ Sufficient balance\n');

    // 3. Override config with mode settings
    (config as any).totalTokensToCreate = modeConfig.tokensToCreate;
    (config as any).durationHours = modeConfig.durationHours;
    (config as any).numWallets = modeConfig.numWallets;

    // 4. Reset state (each cron run starts fresh)
    console.log('🔄 Resetting state for new run...');
    await resetState();

    // 5. Run scheduler
    console.log('🚀 Starting token creation...\n');
    await runScheduler();

    // 6. Send report
    const endBalance = await getBalance(masterWallet);
    const state = loadState();
    await sendReport(startBalance, endBalance, state.tokensCreated);

    console.log('✅ Cron job completed successfully!\n');
    process.exit(0);
  } catch (error) {
    await sendAlert('Cron job failed', {
      mode: modeConfig.name,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    console.error('\n❌ Cron job failed:', error);
    process.exit(1);
  }
}

main();
