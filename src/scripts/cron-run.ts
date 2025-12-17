/**
 * Cron job for Railway
 * - Runs once and exits (not a daemon)
 * - Resets state before each run
 * - Uses MODE env var to determine configuration (peak or low)
 * - Peak (21:00): 30 tokens, 4 hours
 * - Low (01:00): 20 tokens, 15 hours
 */

import { formatEther, parseEther } from 'viem';
import { deriveWallet, getBalance } from '../services/wallet';
import { config } from '../config';
import { runScheduler } from '../services/scheduler';
import { loadState } from '../services/storage';
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
  const mode = process.env.MODE || 'peak';

  if (mode === 'peak') {
    // Peak: 21:00-01:00 KST (4 hours, 30 tokens)
    return {
      name: 'peak',
      tokensToCreate: 30,
      durationHours: 4,
      numWallets: parseInt(process.env.NUM_WALLETS || '10'),
    };
  } else if (mode === 'low') {
    // Low: 01:00-16:00 KST (15 hours, 20 tokens)
    return {
      name: 'low',
      tokensToCreate: 20,
      durationHours: 15,
      numWallets: parseInt(process.env.NUM_WALLETS || '10'),
    };
  } else {
    throw new Error(`Invalid MODE: ${mode}. Must be 'peak' or 'low'`);
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
    console.log(`  Master wallet: ${formatEther(startBalance)} MON`);
    console.log(`  Required: ${formatEther(requiredBalance)} MON`);

    if (startBalance < requiredBalance) {
      console.log(`  ⚠️  WARNING: Master wallet may have insufficient balance`);
      console.log(`  Shortfall: ${formatEther(requiredBalance - startBalance)} MON`);
      console.log(`  Proceeding anyway (sub-wallets may have balance)...\n`);
    } else {
      console.log('  ✅ Sufficient balance\n');
    }

    // 3. Override config with mode settings
    (config as any).totalTokensToCreate = modeConfig.tokensToCreate;
    (config as any).durationHours = modeConfig.durationHours;
    (config as any).numWallets = modeConfig.numWallets;

    // 4. Run scheduler (state will accumulate across runs)
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
