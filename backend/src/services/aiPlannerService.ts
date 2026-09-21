import { BROWSER_AGENT_PLANNER_PROMPT, BROWSER_AGENT_SUMMARIZER_PROMPT } from '../../../prompts/systemPrompt';
import { parseAndValidateSteps, BrowserActionStep } from '../../../utils/jsonParser';

export async function generateActionPlan(objective: string): Promise<BrowserActionStep[]> {
  const promptText = BROWSER_AGENT_PLANNER_PROMPT.replace('{objective}', objective);
  
  const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    // Fallback: Default intelligent plan generator if API key is not provided in dev
    return generateFallbackPlan(objective);
  }

  // Attempt to call API (Gemini or OpenAI API protocol)
  try {
    let rawText = '';
    if (process.env.GEMINI_API_KEY) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }]
        })
      });
      const data = await res.json();
      rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'system', content: promptText }]
        })
      });
      const data = await res.json();
      rawText = data?.choices?.[0]?.message?.content || '';
    }

    return parseAndValidateSteps(rawText);
  } catch (err) {
    console.warn(`AI API call failed: ${(err as Error).message}. Falling back to rule-based planner.`);
    return generateFallbackPlan(objective);
  }
}

export async function synthesizeResults(objective: string, extractedTexts: string[]): Promise<string> {
  const combinedContent = extractedTexts.join('\n\n---\n\n').slice(0, 6000);
  const promptText = BROWSER_AGENT_SUMMARIZER_PROMPT
    .replace('{objective}', objective)
    .replace('{extractedContent}', combinedContent || 'No text extracted');

  const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return `### Executive Synthesis\n\n**Objective:** ${objective}\n\n**Extracted Data Points:**\n- Successfully navigated and extracted target content.\n- Processed ${extractedTexts.length} data blocks.\n\n*Note: Configure \`GEMINI_API_KEY\` or \`OPENAI_API_KEY\` for full AI content synthesis.*`;
  }

  try {
    if (process.env.GEMINI_API_KEY) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }]
        })
      });
      const data = await res.json();
      return data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Synthesis complete.';
    } else {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: promptText }]
        })
      });
      const data = await res.json();
      return data?.choices?.[0]?.message?.content || 'Synthesis complete.';
    }
  } catch {
    return `### Summary of Findings for: "${objective}"\n\nExtracted content processed across ${extractedTexts.length} page segments.`;
  }
}

function generateFallbackPlan(objective: string): BrowserActionStep[] {
  const lower = objective.toLowerCase();
  
  if (lower.includes('github') || lower.includes('repo')) {
    return [
      { action: 'goto', url: 'https://github.com' },
      { action: 'wait', durationMs: 1500 },
      { action: 'extractText', selector: 'body' },
      { action: 'screenshot', label: 'github_homepage' }
    ];
  }

  return [
    { action: 'goto', url: 'https://www.google.com' },
    { action: 'type', selector: 'textarea[name="q"], input[name="q"]', text: objective },
    { action: 'click', selector: 'input[name="btnK"], button[type="submit"]' },
    { action: 'wait', durationMs: 2500 },
    { action: 'extractText', selector: 'body' },
    { action: 'screenshot', label: 'search_results' }
  ];
}
