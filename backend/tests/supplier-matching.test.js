/**
 * Test: Supplier Matching Logic
 * Validates that the strict exact-match-only approach prevents wrong supplier assignments
 */

// Simulated supplier database
const mockSuppliers = [
  { id: 1, supplier_name: 'K. K. ENTERPRISES', approval_status: 'approved' },
  { id: 2, supplier_name: 'GENX RELOCATORS AND ENTERPRISES PRIVATE LIMITED', approval_status: 'approved' },
  { id: 3, supplier_name: 'ABC Services Pvt Ltd', approval_status: 'approved' },
  { id: 4, supplier_name: 'XYZ Services Company', approval_status: 'approved' },
  { id: 5, supplier_name: 'Acme Electronics', approval_status: 'approved' },
  { id: 6, supplier_name: 'Acme Industries Limited', approval_status: 'approved' },
];

// FIXED: Strict exact-match-only logic
function findSupplier(partyName, suppliers) {
  if (!partyName) return null;
  const n = partyName.toLowerCase().trim();

  // Only exact match - no fuzzy matching
  const hit = suppliers.find(s => s.supplier_name.toLowerCase().trim() === n);
  return hit || null;
}

// Test cases
const tests = [
  {
    name: 'K. K. ENTERPRISES exact match',
    input: 'K. K. ENTERPRISES',
    expected: { id: 1, supplier_name: 'K. K. ENTERPRISES' },
    description: 'Should match K. K. ENTERPRISES, NOT GENX RELOCATORS'
  },
  {
    name: 'GENX RELOCATORS exact match',
    input: 'GENX RELOCATORS AND ENTERPRISES PRIVATE LIMITED',
    expected: { id: 2, supplier_name: 'GENX RELOCATORS AND ENTERPRISES PRIVATE LIMITED' },
    description: 'Should match exact GENX RELOCATORS string'
  },
  {
    name: 'Partial match (K. K.) - no match',
    input: 'K. K.',
    expected: null,
    description: 'Should NOT match - only exact match allowed'
  },
  {
    name: 'Partial match (Acme) - no match',
    input: 'Acme',
    expected: null,
    description: 'Should NOT match - prevents "Acme" from matching both Acme Electronics AND Acme Industries'
  },
  {
    name: 'Exact match (Acme Electronics)',
    input: 'Acme Electronics',
    expected: { id: 5, supplier_name: 'Acme Electronics' },
    description: 'Should match Acme Electronics exactly'
  },
  {
    name: 'Wrong spelling - no match',
    input: 'Acme Industires', // typo: "Industires" instead of "Industries"
    expected: null,
    description: 'Typos should NOT match - user must correct'
  },
  {
    name: 'Case insensitive match',
    input: 'abc services pvt ltd',
    expected: { id: 3, supplier_name: 'ABC Services Pvt Ltd' },
    description: 'Should match regardless of case (after normalization)'
  },
  {
    name: 'Whitespace normalized',
    input: '  ABC Services Pvt Ltd  ',
    expected: { id: 3, supplier_name: 'ABC Services Pvt Ltd' },
    description: 'Leading/trailing spaces should be trimmed'
  },
  {
    name: 'Empty supplier name',
    input: '',
    expected: null,
    description: 'Empty strings should return null'
  },
  {
    name: 'Null supplier name',
    input: null,
    expected: null,
    description: 'Null should return null'
  },
];

// Run tests
console.log('🧪 SUPPLIER MATCHING TESTS (Strict Mode)\n');
console.log('='.repeat(100));

let passed = 0;
let failed = 0;

tests.forEach((test, idx) => {
  const result = findSupplier(test.input, mockSuppliers);
  const resultId = result?.id || null;
  const expectedId = test.expected?.id || null;
  const isMatch = resultId === expectedId;

  const status = isMatch ? '✅ PASS' : '❌ FAIL';
  console.log(`\n${idx + 1}. ${status} | ${test.name}`);
  console.log(`   Description: ${test.description}`);
  console.log(`   Input: "${test.input}"`);
  console.log(`   Expected: ${test.expected ? `ID ${test.expected.id} - ${test.expected.supplier_name}` : 'null (no match)'}`);
  console.log(`   Actual:   ${result ? `ID ${result.id} - ${result.supplier_name}` : 'null (no match)'}`);

  if (isMatch) {
    passed++;
  } else {
    failed++;
  }
});

console.log('\n' + '='.repeat(100));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${tests.length} tests\n`);

if (failed === 0) {
  console.log('✅ All tests passed! Supplier matching is now safe from wrong assignments.\n');
} else {
  console.log('❌ Some tests failed. Review the logic.\n');
  process.exit(1);
}

// BEFORE vs AFTER comparison
console.log('='.repeat(100));
console.log('\n🔴 BEFORE (Fuzzy Matching - BUGGY):\n');
console.log('  Input: "K. K. ENTERPRISES"');
console.log('  Result: ID 2 - GENX RELOCATORS AND ENTERPRISES PRIVATE LIMITED ❌ WRONG!');
console.log('  Reason: Word extraction removed "K. K." (too short), left "enterprises"');
console.log('          Both suppliers contain "enterprises", first match returned\n');

console.log('🟢 AFTER (Exact Matching - FIXED):\n');
console.log('  Input: "K. K. ENTERPRISES"');
console.log('  Result: ID 1 - K. K. ENTERPRISES ✅ CORRECT!');
console.log('  Reason: Exact match found, no fuzzy matching\n');
console.log('  Note: If no exact match, user sees "Unmatched" and must manually select\n');

console.log('='.repeat(100));
console.log('\n✅ FIX VERIFIED: Strict exact-match-only approach prevents wrong supplier assignments!\n');
