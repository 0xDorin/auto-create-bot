/**
 * Simple Volume Bot Service
 * - Checks holder count for created tokens
 * - Executes buy/sell trades to generate volume and earn points
 * - Each wallet operates independently
 */

import { parseEther, formatEther, type Address } from "viem";
import { httpGet } from "./api";
import { config } from "../config";
import { buyTokens, sellTokens } from "./contracts";
import { getBalance, type WalletInstance } from "./wallet";
import { calculateMonAmount } from "./priceOracle";
import { loadState } from "./storage";

/**
 * Holder info from API
 */
interface HolderResponse {
  holders: Array<{
    account_info: {
      account_id: string;
      bio: string;
      image_uri: string;
      nickname: string;
    };
    balance_info: {
      balance: string;
      created_at: number;
      native_price: string;
      token_price: string;
    };
  }>;
  total_count: number;
}

/**
 * Volume bot configuration
 */
export interface VolumeConfig {
  mnemonic: string;
  numWallets: number;
  dailyTrades: number;
  targetPoints: number;
  delayRandomness: number;
}

/**
 * Trade result type
 */
export type TradeResult =
  | { status: "success" }
  | { status: "insufficient_balance"; needed: bigint; available: bigint }
  | { status: "graduated" }
  | { status: "target_too_low" }
  | { status: "has_other_holders" };

/**
 * Get volume bot configuration from env
 */
export function getVolumeConfig(): VolumeConfig {
  const mnemonic = process.env.VOLUME_MNEMONIC;
  if (!mnemonic) {
    throw new Error("VOLUME_MNEMONIC is required");
  }

  const targetPoints = parseFloat(process.env.VOLUME_TARGET_POINTS || "0");
  if (targetPoints <= 0) {
    throw new Error(
      "VOLUME_TARGET_POINTS must be greater than 0 (volume bot requires trading)"
    );
  }

  return {
    mnemonic,
    numWallets: parseInt(process.env.VOLUME_WALLETS || "24"),
    dailyTrades: parseInt(process.env.VOLUME_DAILY_TRADES || "96"),
    targetPoints,
    delayRandomness: parseFloat(process.env.VOLUME_DELAY_RANDOMNESS || "0.3"),
  };
}

/**
 * Check holder count for a token
 */
export async function checkHolderCount(tokenAddress: string): Promise<number> {
  const baseUrl =
    config.networkMode === "mainnet"
      ? process.env.MAINNET_METADATA_API_BASE_URL!
      : process.env.TESTNET_METADATA_API_BASE_URL!;

  const response = await httpGet<HolderResponse>(
    baseUrl,
    `/trade/holder/${tokenAddress}`
  );

  return response.total_count;
}

/**
 * Get tokens where I'm the only holder (total_count === 0)
 */
export async function getEligibleTokens(): Promise<
  Array<{ tokenAddress: string; symbol: string }>
> {
  const state = loadState();

  console.log(
    `\n🔍 Checking ${state.createdTokens.length} created tokens for eligibility...`
  );

  const eligible: Array<{ tokenAddress: string; symbol: string }> = [];

  for (const token of state.createdTokens) {
    try {
      const holderCount = await checkHolderCount(token.tokenAddress);

      if (holderCount === 0) {
        console.log(`  ✅ ${token.metadata.symbol}: ${holderCount} holders`);
        eligible.push({
          tokenAddress: token.tokenAddress,
          symbol: token.metadata.symbol,
        });
      } else {
        console.log(
          `  ⏭️  ${token.metadata.symbol}: ${holderCount} holders (skip)`
        );
      }
    } catch (error) {
      console.error(`  ❌ ${token.metadata.symbol}: Failed to check holders`);
    }
  }

  console.log(
    `\n📊 Found ${eligible.length} eligible tokens (holder count = 0)\n`
  );

  return eligible;
}

/**
 * Execute single volume trade (one buy/sell) for one token with one wallet
 * Checks holder count before trading to ensure no other holders
 */
export async function executeVolumeTrade(
  wallet: WalletInstance,
  tokenAddress: Address,
  tokenSymbol: string,
  targetPoints: number
): Promise<TradeResult> {
  console.log(`\n📈 ${tokenSymbol} - Wallet ${wallet.index}`);

  // 1. Check holder count before trading
  try {
    const holderCount = await checkHolderCount(tokenAddress);
    if (holderCount !== 0) {
      console.log(`  ⏭️  Skipping - has ${holderCount} other holders`);
      return { status: "has_other_holders" };
    }
    console.log(`  ✅ Holder check passed (count: ${holderCount})`);
  } catch (error) {
    console.log(`  ⚠️  Failed to check holder count:`, error);
    // Continue anyway - holder check is best effort
  }

  // 2. Calculate buy amount for target points
  const buyAmountMON = await calculateMonAmount(targetPoints);

  if (buyAmountMON === 0) {
    console.log(`  ⚠️  Target points too low`);
    return { status: "target_too_low" };
  }

  const buyAmount = parseEther(buyAmountMON.toString());

  // 3. Check wallet balance (buy amount + 10 MON for gas)
  const walletBalance = await getBalance(wallet);
  const gasBuffer = parseEther("10"); // 10 MON buffer for gas fees
  const requiredBalance = buyAmount + gasBuffer;

  if (walletBalance < requiredBalance) {
    console.log(
      `  ⚠️  Insufficient balance: have ${formatEther(
        walletBalance
      )}, need ${formatEther(requiredBalance)} MON (${formatEther(
        buyAmount
      )} + 10 gas)`
    );
    return {
      status: "insufficient_balance",
      needed: requiredBalance,
      available: walletBalance,
    };
  }

  try {
    // 4. Buy tokens
    console.log(`  💰 Buying ${formatEther(buyAmount)} MON worth...`);
    const tokensReceived = await buyTokens(wallet, tokenAddress, buyAmount);
    console.log(`  ✅ Received ${formatEther(tokensReceived)} tokens`);

    // 5. Sell all tokens
    console.log(`  💰 Selling ${formatEther(tokensReceived)} tokens...`);
    await sellTokens(wallet, tokenAddress, tokensReceived);
    console.log(`  ✅ Sold successfully`);

    return { status: "success" };
  } catch (error) {
    // Check if token graduated
    if (error instanceof Error && error.message.includes("graduated")) {
      console.log(`  🎓 Token has graduated`);
      return { status: "graduated" };
    }
    // Re-throw other errors
    throw error;
  }
}
