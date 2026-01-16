/**
 * Contract interactions using viem (minimal wrappers)
 */

import { type Address, type Hash, parseEther } from "viem";
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
  // Get expected tokens from Lens (skip if initialBuyAmount is 0)
  let expectedTokens = BigInt(0);
  let minTokens = BigInt(0);

  if (initialBuyAmount > 0n) {
    expectedTokens = await wallet.publicClient.readContract({
      address: ADDRS.LENS as Address,
      abi: lensAbi,
      functionName: "getInitialBuyAmountOut",
      args: [initialBuyAmount],
    });

    minTokens =
      (expectedTokens * BigInt(10000 - TX_DEFAULTS.SLIPPAGE_BPS)) / BigInt(10000);
  }

  const deployFee = parseEther("10");
  const totalValue = deployFee + initialBuyAmount;

  // Get salt and token address from API
  const { salt, address: tokenAddress } = await getSaltAndAddress(
    wallet.address,
    metadata
  );

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
      await new Promise((resolve) => setTimeout(resolve, TIMING.BALANCE_RETRY_DELAY));
    }
  }

  return { tokenAddress, tokensReceived, hash };
}
