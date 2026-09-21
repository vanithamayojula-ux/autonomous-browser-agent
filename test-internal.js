/**
 * Phase 9 Internal Test Suite
 */

const { planSteps, summarizeResult } = require('./planner');
const { executeSteps } = require('./agent');

async function runTest() {
  console.log('=== PHASE 9: MANDATORY INTERNAL TEST STARTED ===');
  const testObjective = 'Search for backend projects and summarize';

  console.log(`\n1. Testing Planner for objective: "${testObjective}"...`);
  const steps = await planSteps(testObjective);
  console.log('Generated Steps:', JSON.stringify(steps, null, 2));

  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('Test failed: Planner returned empty steps!');
  }

  console.log('\n2. Testing Playwright Execution Engine in Headless Cloud Mode...');
  const execution = await executeSteps(steps);
  console.log('Execution Status:', execution.success ? 'SUCCESS' : 'FAILED');
  console.log('Extracted Data Blocks Count:', execution.extractedData.length);
  console.log('Step Logs Count:', execution.logs.length);

  console.log('\n3. Testing Result Summarization...');
  const resultSummary = await summarizeResult(testObjective, execution.extractedData);
  console.log('\nFinal Summary Output:\n', resultSummary);

  console.log('\n=== PHASE 9 INTERNAL TEST COMPLETED SUCCESSFULLY ===');
  process.exit(0);
}

runTest().catch((err) => {
  console.error('\n❌ PHASE 9 TEST FAILED:', err);
  process.exit(1);
});
