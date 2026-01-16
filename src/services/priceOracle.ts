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
 * @param targetPoints Target points to earn
 * @param options.volumeOnly If true, skip create fee calculation (for volume trading)
 */
export async function calculateMonAmount(
  targetPoints: number,
  options?: { volumeOnly?: boolean }
): Promise<number> {
  const priceData = await fetchMonPrice();
  const monPrice = priceData.price;

  let remainingPoints = targetPoints;

  // For token creation: subtract create fee points first
  if (!options?.volumeOnly) {
    const createFeeUSD = 10 * monPrice;
    const createPoints = createFeeUSD * 8; // 8 points per $1
    remainingPoints = targetPoints - createPoints;

    if (remainingPoints <= 0) {
      return 0;
    }
  }

  // Buy points = buyAmountUSD × 0.01 × 10 = buyAmountUSD × 0.1
  // Sell points = (buyAmountUSD × 0.99) × 0.01 × 10 = buyAmountUSD × 0.099
  // Total = buyAmountUSD × 0.199
  const buyAmountUSD = remainingPoints / 0.199;
  const buyAmountMON = buyAmountUSD / monPrice;

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
