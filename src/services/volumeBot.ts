/**
 * Simple Volume Bot Service
 * - Checks holder count for created tokens
 * - Executes buy/sell trades to generate volume and earn points
 * - Each wallet operates independently
 */

import { parseEther, formatEther, type Address } from "viem";
import { getHolderCount } from "./nadfunApi";
import { config } from "../config";
import { getBalance, getSDK, type WalletInstance } from "./wallet";
import { calculateMonAmount } from "./priceOracle";
import { loadState } from "./storage";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";


/**
 * Volume bot configuration
 */
export interface VolumeConfig {
  mnemonic: string;
  numWallets: number;
  dailyTrades: number;
  targetPoints: number;
  delayRandomness: number;
  tradesPerWallet: number;
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

  const numWallets = parseInt(process.env.VOLUME_WALLETS || "");
  if (!process.env.VOLUME_WALLETS || isNaN(numWallets) || numWallets <= 0) {
    throw new Error("VOLUME_WALLETS is required and must be greater than 0");
  }

  const dailyTrades = parseInt(process.env.VOLUME_DAILY_TRADES || "");
  if (!process.env.VOLUME_DAILY_TRADES || isNaN(dailyTrades) || dailyTrades <= 0) {
    throw new Error("VOLUME_DAILY_TRADES is required and must be greater than 0");
  }

  const targetPoints = parseFloat(process.env.VOLUME_TARGET_POINTS || "");
  if (!process.env.VOLUME_TARGET_POINTS || isNaN(targetPoints) || targetPoints <= 0) {
    throw new Error("VOLUME_TARGET_POINTS is required and must be greater than 0 (volume bot requires trading)");
  }

  const delayRandomness = parseFloat(process.env.VOLUME_DELAY_RANDOMNESS || "");
  if (!process.env.VOLUME_DELAY_RANDOMNESS || isNaN(delayRandomness) || delayRandomness < 0) {
    throw new Error("VOLUME_DELAY_RANDOMNESS is required and must be >= 0");
  }

  const tradesPerWallet = parseInt(process.env.VOLUME_TRADES_PER_WALLET || "");
  if (!process.env.VOLUME_TRADES_PER_WALLET || isNaN(tradesPerWallet) || tradesPerWallet <= 0) {
    throw new Error("VOLUME_TRADES_PER_WALLET is required and must be greater than 0");
  }

  return {
    mnemonic,
    numWallets,
    dailyTrades,
    targetPoints,
    delayRandomness,
    tradesPerWallet,
  };
}

// Re-export for backward compatibility
export { getHolderCount as checkHolderCount } from "./nadfunApi";

/**
 * Get tokens where I'm the only holder (total_count === 0)
 * Returns tokens in the same format as BotState.createdTokens for compatibility
 * Sources:
 * 1. state.createdTokens (tokens created by this bot)
 * 2. data/eligible-tokens.json (fetched tokens from fetch-eligible-tokens script)
 */
export async function getEligibleTokens(): Promise<
  Array<{
    tokenAddress: string;
    metadata?: { symbol: string; name: string; [key: string]: any };
    createdAt: number;
    walletIndex?: number;
  }>
> {
  const state = loadState();
  const eligible: Array<{
    tokenAddress: string;
    metadata?: { symbol: string; name: string; [key: string]: any };
    createdAt: number;
    walletIndex?: number;
  }> = [];

  // 1. Check created tokens from state
  console.log(
    `\n🔍 Checking ${state.createdTokens.length} created tokens for eligibility...`
  );

  for (const token of state.createdTokens) {
    try {
      const holderCount = await getHolderCount(token.tokenAddress);

      if (holderCount === 0) {
        console.log(`  ✅ ${token.metadata.symbol}: ${holderCount} holders`);
        eligible.push(token); // Push entire token object (matches format)
      } else {
        console.log(
          `  ⏭️  ${token.metadata.symbol}: ${holderCount} holders (skip)`
        );
      }
    } catch (error) {
      console.error(`  ❌ ${token.metadata.symbol}: Failed to check holders`);
    }
  }

  // 2. Load tokens from eligible-tokens.json if exists
  const eligibleTokensPath = resolve(__dirname, "../../data/eligible-tokens.json");
  if (existsSync(eligibleTokensPath)) {
    try {
      const fileContent = readFileSync(eligibleTokensPath, "utf-8");
      const fileData = JSON.parse(fileContent);
      const fetchedTokens = fileData.tokens || [];

      console.log(`\n📂 Loading ${fetchedTokens.length} tokens from eligible-tokens.json...`);

      for (const token of fetchedTokens) {
        // Convert to standard format
        const standardToken = {
          tokenAddress: token.tokenAddress,
          metadata: token.symbol
            ? { symbol: token.symbol, name: token.name }
            : undefined,
          createdAt: token.createdAt || Date.now(),
          walletIndex: undefined,
        };

        // Avoid duplicates
        const exists = eligible.some((t) => t.tokenAddress === standardToken.tokenAddress);
        if (!exists) {
          eligible.push(standardToken);
        }
      }

      console.log(`  ✅ Added ${fetchedTokens.length} fetched tokens`);
    } catch (error) {
      console.warn(`  ⚠️  Failed to load eligible-tokens.json:`, error);
    }
  }

  console.log(
    `\n📊 Total eligible tokens: ${eligible.length}\n`
  );

  return eligible;
}

/**
 * Execute single volume trade (one buy/sell) for one token with one wallet
 * @param mnemonic - Mnemonic for SDK initialization
 * @param skipHolderCheck - Skip holder count check (for latest_trade mode)
 */
export async function executeVolumeTrade(
  wallet: WalletInstance,
  tokenAddress: Address,
  tokenSymbol: string,
  targetPoints: number,
  mnemonic: string,
  options?: { skipHolderCheck?: boolean }
): Promise<TradeResult> {
  console.log(`\n📈 ${tokenSymbol} - Wallet ${wallet.index}`);

  // 1. Check holder count before trading (unless skipped)
  if (!options?.skipHolderCheck) {
    try {
      const holderCount = await getHolderCount(tokenAddress);
      if (holderCount !== 0) {
        console.log(`  ⏭️  Skipping - has ${holderCount} other holders`);
        return { status: "has_other_holders" };
      }
      console.log(`  ✅ Holder check passed (count: ${holderCount})`);
    } catch (error) {
      console.log(`  ⚠️  Failed to check holder count:`, error);
      // Continue anyway - holder check is best effort
    }
  }

  // 2. Calculate buy amount for target points (volumeOnly: skip create fee)
  const buyAmountMON = await calculateMonAmount(targetPoints, { volumeOnly: true });

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
    // Get SDK instance (lazy + cached)
    const sdk = getSDK(mnemonic, wallet.index);

    // 4. Buy tokens using SDK
    const buyResult = await sdk.simpleBuy({
      token: tokenAddress,
      amountIn: buyAmount,
      slippagePercent: 1,
    });
    const tokensReceived = await sdk.getBalance(tokenAddress);
    console.log(`  💰 Buy: ${formatEther(buyAmount)} MON → ${formatEther(tokensReceived)} tokens`);

    // 5. Sell all tokens using SDK (auto approve)
    const sellResult = await sdk.simpleSell({
      token: tokenAddress,
      amountIn: tokensReceived,
      slippagePercent: 1,
    });
    console.log(`  💰 Sell: ${formatEther(tokensReceived)} tokens → MON`);

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
