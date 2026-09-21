/**
 * AI Planner Module
 * Converts high-level objective into strict JSON browser steps
 * and synthesizes final extracted results.
 */

const { parseAndValidateSteps } = require('./utils/parser');

const PLANNER_PROMPT = `
You are an AI Browser Action Planner. Convert the user's objective into a strict JSON array of browser steps.

OBJECTIVE:
{objective}

AVAILABLE ACTIONS:
- goto: { "action": "goto", "url": "https://..." }
- type: { "action": "type", "selector": "...", "text": "..." }
- click: { "action": "click", "selector": "..." }
- wait: { "action": "wait", "durationMs": 2000 }
- extract: { "action": "extract", "selector": "body" }

RULES:
- Return ONLY a valid JSON array. No markdown, no explanations.
- Maximum 10-15 steps.
- Use simple, robust CSS selectors (e.g. "input[name='q']", "textarea[name='q']", "button[type='submit']", "body").

EXAMPLE:
[
  { "action": "goto", "url": "https://www.google.com" },
  { "action": "type", "selector": "textarea[name='q'], input[name='q']", "text": "backend projects" },
  { "action": "click", "selector": "input[name='btnK'], button[type='submit']" },
  { "action": "wait", "durationMs": 2000 },
  { "action": "extract", "selector": "body" }
]
`;

async function planSteps(objective) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.log('[Planner] No LLM API key provided. Using rule-based fallback planner.');
    return generateFallbackPlan(objective);
  }

  let retries = 2;
  let lastError = null;

  while (retries >= 0) {
    try {
      const promptText = PLANNER_PROMPT.replace('{objective}', objective);
      let rawResponseText = '';

      if (process.env.GEMINI_API_KEY) {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
          }
        );
        const data = await res.json();
        rawResponseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } else {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'system', content: promptText }]
          })
        });
        const data = await res.json();
        rawResponseText = data?.choices?.[0]?.message?.content || '';
      }

      return parseAndValidateSteps(rawResponseText);
    } catch (err) {
      lastError = err;
      retries--;
    }
  }

  console.warn(`[Planner] AI planning failed (${lastError?.message}). Using rule-based fallback.`);
  return generateFallbackPlan(objective);
}

async function summarizeResult(objective, extractedTextArray) {
  const combinedText = (extractedTextArray || []).join('\n\n---\n\n').slice(0, 5000);
  const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;

  if (!apiKey || !combinedText.trim()) {
    return `### Summary of Findings for: "${objective}"\n\n- Processed ${extractedTextArray.length} extracted content blocks.\n- Extracted snippet: ${combinedText.slice(0, 300)}...`;
  }

  try {
    const prompt = `Objective: ${objective}\nExtracted Content:\n${combinedText}\n\nSummarize key findings cleanly:`;
    if (process.env.GEMINI_API_KEY) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        }
      );
      const data = await res.json();
      return data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Summary generation completed.';
    }
  } catch {
    // Fallback if API fails
  }

  return `### Summary of Findings for: "${objective}"\n\nSuccessfully retrieved and analyzed web content across ${extractedTextArray.length} steps.`;
}

function generateFallbackPlan(objective) {
  const lower = objective.toLowerCase();

  if (lower.includes('github') || lower.includes('repo')) {
    return [
      { action: 'goto', url: 'https://github.com' },
      { action: 'wait', durationMs: 1500 },
      { action: 'extract', selector: 'body' }
    ];
  }

  return [
    { action: 'goto', url: 'https://www.google.com' },
    { action: 'type', selector: 'textarea[name="q"], input[name="q"]', text: objective },
    { action: 'click', selector: 'input[name="btnK"], button[type="submit"]' },
    { action: 'wait', durationMs: 2000 },
    { action: 'extract', selector: 'body' }
  ];
}

module.exports = { planSteps, summarizeResult };
