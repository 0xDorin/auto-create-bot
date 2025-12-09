/**
 * Contract interactions using viem (minimal wrappers)
 */

import { type Address, type Hash, parseEther, formatEther } from "viem";
import { bondingCurveRouterAbi, lensAbi, erc20Abi } from "../abi";
import { CONTRACTS, TX_DEFAULTS, TIMING } from "../config/constants";
import { config } from "../config";
import type { WalletInstance } from "./wallet";
import { randomBytes } from "crypto";

const ADDRS = CONTRACTS[config.networkMode];

/**
 * Generate random salt
 */
export function generateSalt(): `0x${string}` {
  return `0x${randomBytes(32).toString("hex")}`;
}

interface saltReturnType {
  salt: `0x${string}`;
  address: Address;
}

/**
 * Get salt and token address from API
 */
async function getSaltAndAddress(
  creator: Address,
  metadata: { name: string; symbol: string; tokenURI: string }
): Promise<saltReturnType> {
  const response = await fetch(
    `${config.metadataUploadApiBaseUrl}/token/salt`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        creator,
        metadata_uri: metadata.tokenURI,
        name: metadata.name,
        symbol: metadata.symbol,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get salt: ${response.status}`);
  }

  const data = (await response.json()) as saltReturnType;
  return { salt: data.salt, address: data.address };
}

/**
 * Create token with initial buy
 */
export async function createToken(
  wallet: WalletInstance,
  metadata: {
    name: string;
    symbol: string;
    tokenURI: string;
  },
  initialBuyAmount: bigint
): Promise<{ tokenAddress: Address; tokensReceived: bigint; hash: Hash }> {
  // Get expected tokens from Lens
  const expectedTokens = await wallet.publicClient.readContract({
    address: ADDRS.LENS as Address,
    abi: lensAbi,
    functionName: "getInitialBuyAmountOut",
    args: [initialBuyAmount],
  });

  const minTokens =
    (expectedTokens * BigInt(10000 - TX_DEFAULTS.SLIPPAGE_BPS)) / BigInt(10000);
  const deployFee = parseEther("10");
  const totalValue = deployFee + initialBuyAmount;

  // Get salt and token address from API
  const { salt, address: tokenAddress } = await getSaltAndAddress(
    wallet.address,
    metadata
  );

  console.log(`Creating token: ${metadata.symbol}`);
  console.log(`  Token address: ${tokenAddress}`);
  console.log(`  Deploy fee: ${formatEther(deployFee)} MON`);
  console.log(`  Initial buy: ${formatEther(initialBuyAmount)} MON`);
  console.log(`  Expected tokens: ${formatEther(expectedTokens)}`);
  console.log(`  Min tokens (1% slippage): ${formatEther(minTokens)}`);

  // Create token
  const hash = await wallet.walletClient.writeContract({
    address: ADDRS.BONDING_CURVE_ROUTER as Address,
    abi: bondingCurveRouterAbi,
    functionName: "create",
    args: [
      {
        name: metadata.name,
        symbol: metadata.symbol,
        tokenURI: metadata.tokenURI,
        amountOut: minTokens,
        salt,
        actionId: 1,
      },
    ],
    account: wallet.account,
    chain: wallet.walletClient.chain,
    value: totalValue,
  });

  console.log(`  Transaction hash: ${hash}`);

  // Wait for receipt
  const receipt = await wallet.publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status === "reverted") {
    throw new Error(`Token creation reverted: ${hash}`);
  }

  // Wait a bit for contract state to be fully synced on RPC node
  await new Promise((resolve) => setTimeout(resolve, TIMING.RPC_SYNC_DELAY));

  // Get token balance with retry
  let tokensReceived: bigint = 0n;
  for (let attempt = 1; attempt <= TIMING.BALANCE_MAX_RETRIES; attempt++) {
    try {
      tokensReceived = await wallet.publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet.address],
      });
      break;
    } catch (error) {
      if (attempt === TIMING.BALANCE_MAX_RETRIES) throw error;
      console.log(`  ⚠️  balanceOf failed (attempt ${attempt}/${TIMING.BALANCE_MAX_RETRIES}), retrying...`);
      await new Promise((resolve) => setTimeout(resolve, TIMING.BALANCE_RETRY_DELAY));
    }
  }

  console.log(`  ✅ Token created: ${tokenAddress}`);
  console.log(`  Tokens received: ${formatEther(tokensReceived)}`);

  return { tokenAddress, tokensReceived, hash };
}

/**
 * Sell tokens on bonding curve
 */
export async function sellTokens(
  wallet: WalletInstance,
  tokenAddress: Address,
  amount: bigint
): Promise<Hash> {
  // Check if graduated
  const isGraduated = await wallet.publicClient.readContract({
    address: ADDRS.LENS as Address,
    abi: lensAbi,
    functionName: "isGraduated",
    args: [tokenAddress],
  });

  if (isGraduated) {
    throw new Error("Token has graduated - use DEX router instead");
  }

  // Get quote
  const [router, expectedMon] = await wallet.publicClient.readContract({
    address: ADDRS.LENS as Address,
    abi: lensAbi,
    functionName: "getAmountOut",
    args: [tokenAddress, amount, false],
  });

  const minMon =
    (expectedMon * BigInt(10000 - TX_DEFAULTS.SLIPPAGE_BPS)) / BigInt(10000);
  const deadline = BigInt(
    Math.floor(Date.now() / 1000) + TX_DEFAULTS.DEADLINE_OFFSET
  );

  console.log(`Selling tokens: ${formatEther(amount)}`);
  console.log(`  Expected MON: ${formatEther(expectedMon)}`);
  console.log(`  Min MON (1% slippage): ${formatEther(minMon)}`);

  // Approve
  console.log(`  Approving router...`);
  const approveHash = await wallet.walletClient.writeContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [ADDRS.BONDING_CURVE_ROUTER as Address, amount],
    account: wallet.account,
    chain: wallet.walletClient.chain,
  });

  await wallet.publicClient.waitForTransactionReceipt({ hash: approveHash });

  // Sell
  const hash = await wallet.walletClient.writeContract({
    address: ADDRS.BONDING_CURVE_ROUTER as Address,
    abi: bondingCurveRouterAbi,
    functionName: "sell",
    args: [
      {
        amountIn: amount,
        amountOutMin: minMon,
        token: tokenAddress,
        to: wallet.address,
        deadline,
      },
    ],
    account: wallet.account,
    chain: wallet.walletClient.chain,
  });

  console.log(`  Transaction hash: ${hash}`);

  const receipt = await wallet.publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status === "reverted") {
    throw new Error(`Token sell reverted: ${hash}`);
  }

  console.log(`  ✅ Sold successfully`);

  return hash;
}
