import { Router, Request, Response } from 'express';
import { sanitizeObjective } from '../../../utils/security';
import { generateActionPlan, synthesizeResults } from '../services/aiPlannerService';
import { executePlanSteps, StepLogEvent } from '../../../agent/src/executionEngine';

const router = Router();

router.post('/run', async (req: Request, res: Response): Promise<void> => {
  try {
    const rawObjective = req.body?.objective;
    const objective = sanitizeObjective(rawObjective);

    // 1. Generate Action Plan via AI Planner
    const planSteps = await generateActionPlan(objective);

    // 2. Execute Plan Steps via Playwright Execution Engine
    const execution = await executePlanSteps(planSteps);

    // 3. Synthesize Findings via AI Summarizer
    const summary = await synthesizeResults(objective, execution.extractedData);

    res.json({
      success: execution.success,
      objective,
      plan: planSteps,
      logs: execution.logs,
      screenshots: execution.screenshots,
      summary,
      error: execution.error
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: (err as Error).message
    });
  }
});

router.get('/stream', async (req: Request, res: Response): Promise<void> => {
  const rawObjective = req.query.objective as string;

  try {
    const objective = sanitizeObjective(rawObjective);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendSSE = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendSSE('status', { message: 'Planning steps via AI...' });
    const planSteps = await generateActionPlan(objective);
    sendSSE('plan', { steps: planSteps });

    const execution = await executePlanSteps(planSteps, (logEvent: StepLogEvent) => {
      sendSSE('step', logEvent);
    });

    sendSSE('status', { message: 'Synthesizing results...' });
    const summary = await synthesizeResults(objective, execution.extractedData);

    sendSSE('done', {
      success: execution.success,
      summary,
      screenshots: execution.screenshots
    });

    res.end();
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
    res.end();
  }
});

export default router;
