/**
 * Smoke Test Script
 * Tests core nad SDK functionality against real testnet
 *
 * Usage: npm run test:smoke
 */

import { formatEther, type Address } from "viem";
import { config } from "../config";
import { deriveWallet, getBalance } from "../services/wallet";
import { getTokenList, getHolders, getHolderCount } from "../services/nadfunApi";
import { fetchMonPrice } from "../services/priceOracle";

// =============================================================================
// Test Utilities
// =============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: string;
}

const results: TestResult[] = [];

async function runTest(
  name: string,
  testFn: () => Promise<string | void>
): Promise<void> {
  const start = Date.now();
  try {
    const details = await testFn();
    results.push({
      name,
      passed: true,
      duration: Date.now() - start,
      details: details || undefined,
    });
    console.log(`  ✅ ${name} (${Date.now() - start}ms)`);
    if (details) console.log(`     ${details}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    results.push({
      name,
      passed: false,
      duration: Date.now() - start,
      error: errorMsg,
    });
    console.log(`  ❌ ${name} (${Date.now() - start}ms)`);
    console.log(`     Error: ${errorMsg}`);
  }
}

// =============================================================================
// Tests
// =============================================================================

async function testWallet(): Promise<void> {
  console.log("\n📦 Wallet Tests");
  console.log("-".repeat(50));

  await runTest("deriveWallet", async () => {
    const wallet = deriveWallet(config.mnemonic, 0);
    if (!wallet.address) throw new Error("No address");
    if (!wallet.walletClient) throw new Error("No walletClient");
    if (!wallet.publicClient) throw new Error("No publicClient");
    return `Address: ${wallet.address}`;
  });

  await runTest("getBalance", async () => {
    const wallet = deriveWallet(config.mnemonic, 0);
    const balance = await getBalance(wallet);
    return `Balance: ${formatEther(balance)} MON`;
  });
}

async function testPriceOracle(): Promise<void> {
  console.log("\n💰 Price Oracle Tests");
  console.log("-".repeat(50));

  await runTest("fetchMonPrice", async () => {
    const priceData = await fetchMonPrice();
    if (priceData.price <= 0) throw new Error(`Invalid price: ${priceData.price}`);
    return `MON Price: $${priceData.price.toFixed(4)}`;
  });
}

async function testNadfunApi(): Promise<void> {
  console.log("\n🌐 nad.fun API Tests");
  console.log("-".repeat(50));

  let testTokenAddress: string | null = null;

  await runTest("getTokenList (latest_trade)", async () => {
    const response = await getTokenList(
      { page: 1, limit: 10, is_nsfw: false },
      "latest_trade"
    );
    if (!response.tokens || response.tokens.length === 0) {
      throw new Error("No tokens returned");
    }
    testTokenAddress = response.tokens[0].token_info.token_id;
    return `Found ${response.tokens.length} tokens, first: ${response.tokens[0].token_info.symbol}`;
  });

  await runTest("getTokenList (creation_time_desc)", async () => {
    const response = await getTokenList(
      { page: 1, limit: 5, is_nsfw: false },
      "creation_time_desc"
    );
    if (!response.tokens) throw new Error("No tokens field");
    return `Found ${response.tokens.length} tokens`;
  });

  await runTest("getHolders", async () => {
    if (!testTokenAddress) throw new Error("No test token available");
    const response = await getHolders(testTokenAddress);
    return `Holders: ${response.total_count}, token: ${testTokenAddress.slice(0, 10)}...`;
  });

  await runTest("getHolderCount", async () => {
    if (!testTokenAddress) throw new Error("No test token available");
    const count = await getHolderCount(testTokenAddress);
    return `Holder count: ${count}`;
  });
}

async function testSaltApi(): Promise<void> {
  console.log("\n🔑 Salt API Tests");
  console.log("-".repeat(50));

  await runTest("Salt API reachable", async () => {
    const wallet = deriveWallet(config.mnemonic, 0);

    const response = await fetch(
      `${config.metadataUploadApiBaseUrl}/token/salt`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creator: wallet.address,
          metadata_uri: "https://storage.nadapp.net/test",
          name: "TestToken",
          symbol: "TEST",
        }),
      }
    );

    // API responded (even 400/404 means the API is reachable)
    const body = await response.text();

    if (response.ok) {
      const data = JSON.parse(body) as { salt: string; address: string };
      return `Salt: ${data.salt.slice(0, 20)}..., Address: ${data.address.slice(0, 20)}...`;
    }

    // 400 error with valid JSON error message means API is working
    if (response.status === 400 || response.status === 404) {
      return `API responded with ${response.status} (expected for test URI)`;
    }

    throw new Error(`Unexpected status ${response.status}: ${body}`);
  });
}

async function testContractReads(): Promise<void> {
  console.log("\n📜 Contract Read Tests");
  console.log("-".repeat(50));

  await runTest("Lens getInitialBuyAmountOut", async () => {
    const { CONTRACTS } = await import("../config/constants");
    const { lensAbi } = await import("../abi");
    const wallet = deriveWallet(config.mnemonic, 0);
    const ADDRS = CONTRACTS[config.networkMode];

    const amount = await wallet.publicClient.readContract({
      address: ADDRS.LENS as Address,
      abi: lensAbi,
      functionName: "getInitialBuyAmountOut",
      args: [BigInt(10e18)], // 10 MON
    });

    return `10 MON → ${formatEther(amount)} tokens`;
  });
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("🧪 NAD SDK SMOKE TEST");
  console.log("=".repeat(60));
  console.log(`Time: ${new Date().toLocaleString()}`);
  console.log(`Network: ${config.networkMode}`);
  console.log("=".repeat(60));

  // Run all tests
  await testWallet();
  await testPriceOracle();
  await testNadfunApi();
  await testSaltApi();
  await testContractReads();

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 TEST SUMMARY");
  console.log("=".repeat(60));

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;

  console.log(`  Total:  ${total}`);
  console.log(`  Passed: ${passed} ✅`);
  console.log(`  Failed: ${failed} ❌`);
  console.log();

  if (failed > 0) {
    console.log("Failed tests:");
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        console.log(`  - ${r.name}: ${r.error}`);
      });
    process.exit(1);
  }

  console.log("✅ All tests passed!\n");
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
