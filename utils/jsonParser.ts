/**
 * JSON Parsing and Validation Utilities for AI Action Steps
 */

export interface BrowserActionStep {
  action: 'goto' | 'type' | 'click' | 'wait' | 'extractText' | 'screenshot';
  url?: string;
  selector?: string;
  text?: string;
  durationMs?: number;
  label?: string;
}

export function parseAndValidateSteps(llmRawResponse: string): BrowserActionStep[] {
  let cleaned = llmRawResponse.trim();

  // Strip markdown code block wrappers if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  // Find array bounds if extra text was included
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');

  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    cleaned = cleaned.substring(firstBracket, lastBracket + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Invalid JSON output from LLM planner: ${(err as Error).message}\nRaw: ${llmRawResponse}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('LLM planner output must be a JSON array of action step objects');
  }

  const validActions = ['goto', 'type', 'click', 'wait', 'extractText', 'screenshot'];
  const validatedSteps: BrowserActionStep[] = [];

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (typeof item !== 'object' || item === null) {
      throw new Error(`Step #${i + 1} is not a valid object`);
    }

    const action = (item as BrowserActionStep).action;
    if (!validActions.includes(action)) {
      throw new Error(`Step #${i + 1} contains unknown action "${action}"`);
    }

    validatedSteps.push(item as BrowserActionStep);
  }

  if (validatedSteps.length === 0) {
    throw new Error('No action steps were generated in the plan');
  }

  return validatedSteps;
}
