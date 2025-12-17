/**
 * Pyth Network price oracle service
 * Fetches MON/USD price from Pyth Hermes API (free)
 */

import { httpGet } from "./api";

/**
 * Pyth price feed response
 */
interface PythPriceUpdate {
  parsed: Array<{
    id: string;
    price: {
      price: string;
      conf: string;
      expo: number;
      publish_time: number;
    };
  }>;
}

/**
 * Parsed price data
 */
export interface PriceData {
  price: number; // USD price
  confidence: number; // Confidence interval
  timestamp: number; // Unix timestamp
}

// Price cache
let cachedPrice: PriceData | null = null;
let cacheExpiry: number = 0;

const PYTH_HERMES_URL =
  process.env.PYTH_HERMES_URL || "https://hermes.pyth.network";
const PYTH_MON_FEED_ID =
  process.env.PYTH_MON_FEED_ID ||
  "0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1";
const CACHE_TTL_MS =
  parseInt(process.env.PRICE_CACHE_TTL_SECONDS || "60") * 1000;

/**
 * Fetch MON/USD price from Pyth Hermes API
 */
export async function fetchMonPrice(): Promise<PriceData> {
  // Check cache
  if (cachedPrice && Date.now() < cacheExpiry) {
    return cachedPrice;
  }

  const response = await httpGet<PythPriceUpdate>(
    PYTH_HERMES_URL,
    "/v2/updates/price/latest",
    {
      params: {
        "ids[]": PYTH_MON_FEED_ID,
      },
    }
  );

  if (!response.parsed || response.parsed.length === 0) {
    throw new Error("No price data returned from Pyth");
  }

  const priceData = response.parsed[0]!.price;

  // Parse price: price * 10^expo
  let price = parseFloat(priceData.price) * Math.pow(10, priceData.expo);
  const confidence = parseFloat(priceData.conf) * Math.pow(10, priceData.expo);

  if (process.env.NETWORK_MODE === "testnet") {
    price *= 100;
  }

  const result: PriceData = {
    price,
    confidence,
    timestamp: priceData.publish_time,
  };

  // Update cache
  cachedPrice = result;
  cacheExpiry = Date.now() + CACHE_TTL_MS;

  console.log(`✅ MON/USD: $${price.toFixed(6)}`);

  return result;
}

/**
 * Calculate buy amount to achieve target points
 *
 * Point system: $1 fee = 10 points (base)
 * - Create fee (10 MON): 8 points per $1 (0.8x multiplier)
 * - Buy fee (1%): 10 points per $1 (1.0x multiplier)
 * - Sell fee (1%): 10 points per $1 (1.0x multiplier)
 *
 * Fee structure:
 * - Create fee: 10 MON (fixed)
 * - Buy fee: 1% of buy amount
 * - Sell fee: 1% of (buy amount × 0.99)
 *
 * Points formula:
 * 10 MON × price × 8 + buyAmount × 0.01 × 10 + (buyAmount × 0.99) × 0.01 × 10 = targetPoints
 * 80 MON × price + buyAmount × 0.199 = targetPoints
 * buyAmount = (targetPoints - 80 MON × price) / 0.199
 *
 * @param targetPoints Target points to earn (default: 20.5)
 */
export async function calculateMonAmount(
  targetPoints: number
): Promise<number> {
  const priceData = await fetchMonPrice();
  const monPrice = priceData.price;

  // Create fee: 10 MON (fixed), earns 8 points per $1 of fee
  const createFeeUSD = 10 * monPrice;
  const createPoints = createFeeUSD * 8; // $X × 8 points/$

  // Remaining points needed from buy/sell fees
  const remainingPoints = targetPoints - createPoints;

  if (remainingPoints <= 0) {
    console.log(`⚠️  Target points (${targetPoints}) ≤ Create fee points (${createPoints.toFixed(2)})`);
    console.log(`   Create fee: 10 MON × $${monPrice.toFixed(6)} × 8 = ${createPoints.toFixed(2)} pts`);
    console.log(`   → Skipping initial buy (create only)`);
    return 0;
  }

  // Buy points = buyAmount × 0.01 × 10 = buyAmount × 0.1
  // Sell points = (buyAmount × 0.99) × 0.01 × 10 = buyAmount × 0.099
  // Total = buyAmount × 0.199
  const buyAmountUSD = remainingPoints / 0.199;
  const buyAmountMON = buyAmountUSD / monPrice;

  // Calculate fees and points for display
  const buyFeeUSD = buyAmountUSD * 0.01;
  const buyPoints = buyFeeUSD * 10;

  const afterBuyUSD = buyAmountUSD * 0.99;
  const sellFeeUSD = afterBuyUSD * 0.01;
  const sellPoints = sellFeeUSD * 10;

  const totalFeeUSD = createFeeUSD + buyFeeUSD + sellFeeUSD;
  const totalPoints = createPoints + buyPoints + sellPoints;

  console.log(
    `💰 Buy: ${buyAmountMON.toFixed(2)} MON ($${buyAmountUSD.toFixed(
      2
    )}) → ${totalPoints.toFixed(1)} pts`
  );

  return buyAmountMON;
}

/**
 * Calculate USD value of MON amount
 */
export async function calculateUsdValue(monAmount: number): Promise<number> {
  const priceData = await fetchMonPrice();
  return monAmount * priceData.price;
}

/**
 * Clear price cache (useful for testing)
 */
export function clearPriceCache(): void {
  cachedPrice = null;
  cacheExpiry = 0;
}
