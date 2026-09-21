/**
 * Logger Utility for Browser Agent Execution
 */

function createLogger() {
  const logs = [];

  return {
    log(action, detail, status = 'SUCCESS', stepIndex = 0, totalSteps = 0) {
      const entry = {
        timestamp: new Date().toISOString(),
        stepIndex,
        totalSteps,
        action,
        status,
        detail
      };
      logs.push(entry);
      console.log(`[${entry.timestamp}] [STEP ${stepIndex}/${totalSteps}] [${action}] [${status}] - ${detail}`);
      return entry;
    },
    error(action, detail, stepIndex = 0, totalSteps = 0) {
      const entry = {
        timestamp: new Date().toISOString(),
        stepIndex,
        totalSteps,
        action,
        status: 'FAILED',
        detail
      };
      logs.push(entry);
      console.error(`[${entry.timestamp}] [STEP ${stepIndex}/${totalSteps}] [${action}] [FAILED] - ${detail}`);
      return entry;
    },
    getLogs() {
      return [...logs];
    }
  };
}

module.exports = { createLogger };
