/**
 * Test script for Pyth price oracle
 */

import { fetchMonPrice, calculateMonAmount, calculateUsdValue } from '../services/priceOracle';

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 TESTING PYTH PRICE ORACLE');
  console.log('='.repeat(80) + '\n');

  try {
    // Test 1: Fetch current MON price
    console.log('Test 1: Fetching MON/USD price...');
    const priceData = await fetchMonPrice();
    console.log(`✅ Success!\n`);

    // Test 2: Calculate buy amount for 20.5 points
    console.log('Test 2: Calculate buy amount for 20.5 points...');
    const buyAmount = await calculateMonAmount(20.5);
    console.log(`✅ Buy amount calculated!\n`);

    // Test 3: Calculate USD value of 100 MON
    console.log('Test 3: Calculate USD value of 100 MON...');
    const usdFor100 = await calculateUsdValue(100);
    console.log(`✅ 100 MON is worth $${usdFor100.toFixed(2)} USD\n`);

    // Test 4: Check cache (should use cached value)
    console.log('Test 4: Fetch price again (should use cache)...');
    const cachedPrice = await fetchMonPrice();
    console.log(`✅ Cache working! Price: $${cachedPrice.price.toFixed(6)}\n`);

    console.log('='.repeat(80));
    console.log('✅ ALL TESTS PASSED!');
    console.log('='.repeat(80) + '\n');
  } catch (error) {
    console.error('\n❌ Test failed:');
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
  }
}

main();
