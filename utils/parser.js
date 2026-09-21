/**
 * Parser Utility for AI JSON Step Extraction
 */

function parseAndValidateSteps(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Raw text must be a non-empty string');
  }

  let cleaned = rawText.trim();

  // Strip markdown code block fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }

  // Extract JSON array string if extra text exists
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');

  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    cleaned = cleaned.substring(firstBracket, lastBracket + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Invalid JSON output from AI planner: ${err.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('AI planner output must be a JSON array of step objects');
  }

  const allowedActions = ['goto', 'type', 'click', 'wait', 'extract'];
  const validSteps = [];

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (!item || typeof item !== 'object') {
      throw new Error(`Step #${i + 1} is not a valid object`);
    }

    if (!allowedActions.includes(item.action)) {
      throw new Error(`Step #${i + 1} contains unsupported action "${item.action}"`);
    }

    validSteps.push(item);
  }

  if (validSteps.length === 0) {
    throw new Error('Planner generated 0 steps');
  }

  // Cap steps at 15 to prevent abuse or endless loops
  return validSteps.slice(0, 15);
}

module.exports = { parseAndValidateSteps };
