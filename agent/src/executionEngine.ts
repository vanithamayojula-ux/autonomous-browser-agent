import { BrowserEngine } from './browserEngine';
import { BrowserActionStep } from '../../utils/jsonParser';

export interface StepLogEvent {
  stepIndex: number;
  totalSteps: number;
  action: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  detail: string;
  screenshotBase64?: string;
  timestamp: string;
}

export interface ExecutionResult {
  success: boolean;
  logs: StepLogEvent[];
  extractedData: string[];
  screenshots: { stepIndex: number; base64: string }[];
  error?: string;
}

export type LogListener = (event: StepLogEvent) => void;

export async function executePlanSteps(
  steps: BrowserActionStep[],
  onLog?: LogListener
): Promise<ExecutionResult> {
  const engine = new BrowserEngine();
  const logs: StepLogEvent[] = [];
  const extractedData: string[] = [];
  const screenshots: { stepIndex: number; base64: string }[] = [];

  const emitLog = (event: StepLogEvent) => {
    logs.push(event);
    if (onLog) onLog(event);
  };

  try {
    await engine.initialize();

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepNum = i + 1;

      emitLog({
        stepIndex: stepNum,
        totalSteps: steps.length,
        action: step.action,
        status: 'RUNNING',
        detail: `Executing action "${step.action}" ${step.url ? '-> ' + step.url : step.selector ? 'on ' + step.selector : ''}`,
        timestamp: new Date().toISOString()
      });

      let retries = 2;
      let stepSuccess = false;
      let lastStepError: Error | null = null;

      while (retries >= 0 && !stepSuccess) {
        try {
          switch (step.action) {
            case 'goto':
              if (!step.url) throw new Error('Missing target URL for goto action');
              const pageTitle = await engine.goto(step.url);
              emitLog({
                stepIndex: stepNum,
                totalSteps: steps.length,
                action: step.action,
                status: 'SUCCESS',
                detail: `Navigated to ${step.url} (Title: ${pageTitle})`,
                timestamp: new Date().toISOString()
              });
              stepSuccess = true;
              break;

            case 'type':
              if (!step.selector || step.text === undefined) {
                throw new Error('Missing selector or text for type action');
              }
              await engine.type(step.selector, step.text);
              emitLog({
                stepIndex: stepNum,
                totalSteps: steps.length,
                action: step.action,
                status: 'SUCCESS',
                detail: `Typed "${step.text}" into ${step.selector}`,
                timestamp: new Date().toISOString()
              });
              stepSuccess = true;
              break;

            case 'click':
              if (!step.selector) throw new Error('Missing selector for click action');
              await engine.click(step.selector);
              emitLog({
                stepIndex: stepNum,
                totalSteps: steps.length,
                action: step.action,
                status: 'SUCCESS',
                detail: `Clicked element ${step.selector}`,
                timestamp: new Date().toISOString()
              });
              stepSuccess = true;
              break;

            case 'wait':
              await engine.wait(step.durationMs || 2000, step.selector);
              emitLog({
                stepIndex: stepNum,
                totalSteps: steps.length,
                action: step.action,
                status: 'SUCCESS',
                detail: `Waited ${step.durationMs || 2000}ms ${step.selector ? 'for ' + step.selector : ''}`,
                timestamp: new Date().toISOString()
              });
              stepSuccess = true;
              break;

            case 'extractText':
              const extracted = await engine.extractText(step.selector || 'body');
              if (extracted) extractedData.push(extracted);
              emitLog({
                stepIndex: stepNum,
                totalSteps: steps.length,
                action: step.action,
                status: 'SUCCESS',
                detail: `Extracted ${extracted.length} chars from ${step.selector || 'body'}`,
                timestamp: new Date().toISOString()
              });
              stepSuccess = true;
              break;

            case 'screenshot':
              const base64 = await engine.takeScreenshot();
              screenshots.push({ stepIndex: stepNum, base64 });
              emitLog({
                stepIndex: stepNum,
                totalSteps: steps.length,
                action: step.action,
                status: 'SUCCESS',
                detail: `Captured page screenshot (${step.label || 'snapshot'})`,
                screenshotBase64: base64,
                timestamp: new Date().toISOString()
              });
              stepSuccess = true;
              break;
          }
        } catch (err) {
          lastStepError = err as Error;
          retries--;
          if (retries >= 0) {
            await engine.wait(1000); // Brief pause before retry
          }
        }
      }

      if (!stepSuccess) {
        emitLog({
          stepIndex: stepNum,
          totalSteps: steps.length,
          action: step.action,
          status: 'FAILED',
          detail: `Step failed after retries: ${lastStepError?.message || 'Unknown error'}`,
          timestamp: new Date().toISOString()
        });
      }
    }

    await engine.close();
    return {
      success: true,
      logs,
      extractedData,
      screenshots
    };
  } catch (err) {
    await engine.close();
    return {
      success: false,
      logs,
      extractedData,
      screenshots,
      error: (err as Error).message
    };
  }
}
