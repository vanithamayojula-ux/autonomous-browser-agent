/**
 * Render-Hardened AI Browser Agent Express Server
 */

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { planSteps, summarizeResult } = require('./planner');
const { executeSteps } = require('./agent');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));

// Health Check Endpoint for Render Monitoring
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'AI Browser Agent Backend',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Root Route Info
app.get('/', (req, res) => {
  res.json({
    name: 'AI Browser Agent API',
    endpoints: {
      health: 'GET /health',
      runTask: 'POST /run-task'
    }
  });
});

// Main Task Execution Endpoint
app.post('/run-task', async (req, res) => {
  const startTime = Date.now();

  try {
    const { objective } = req.body || {};

    if (!objective || typeof objective !== 'string' || !objective.trim()) {
      return res.status(400).json({
        success: false,
        steps: [],
        logs: [],
        result: '',
        error: 'Missing or invalid "objective" string in request body.'
      });
    }

    const cleanObjective = objective.trim().slice(0, 500);
    console.log(`\n========================================`);
    console.log(`[API] Received Task: "${cleanObjective}"`);
    console.log(`========================================`);

    // 1. AI Planning Phase
    const steps = await planSteps(cleanObjective);

    // 2. Playwright Execution Phase
    const execution = await executeSteps(steps);

    // 3. Result Synthesis Phase
    const resultSummary = await summarizeResult(cleanObjective, execution.extractedData);

    const durationMs = Date.now() - startTime;
    console.log(`[API] Task completed in ${durationMs}ms with status: ${execution.success}`);

    return res.status(200).json({
      success: execution.success,
      steps,
      logs: execution.logs,
      result: resultSummary,
      durationMs,
      error: execution.error || null
    });
  } catch (err) {
    console.error(`[API Error] Handled server exception: ${err.message}`);
    return res.status(500).json({
      success: false,
      steps: [],
      logs: [],
      result: '',
      error: `Internal server error: ${err.message}`
    });
  }
});

// Global 404 Handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Fatal Express Error]', err);
  res.status(500).json({ success: false, error: 'Unhandled server error' });
});

// Render Deployment Requirement: Bind to 0.0.0.0 and process.env.PORT
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 AI Browser Agent Server running on http://0.0.0.0:${PORT}`);
  console.log(`READY FOR RENDER DEPLOYMENT.`);
});
