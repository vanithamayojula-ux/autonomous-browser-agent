/**
 * Security & Sanitization Helper Utilities
 */

export const MAX_ALLOWED_STEPS = 12;
export const MAX_EXECUTION_TIMEOUT_MS = 60000; // 60 seconds total

export function sanitizeObjective(objective: string): string {
  if (!objective || typeof objective !== 'string') {
    throw new Error('Objective must be a non-empty string');
  }

  const trimmed = objective.trim();
  if (trimmed.length < 5) {
    throw new Error('Objective is too short. Please provide a clear descriptive goal.');
  }

  if (trimmed.length > 500) {
    throw new Error('Objective exceeds maximum allowed length of 500 characters.');
  }

  return trimmed;
}

export function isValidUrl(urlStr?: string): boolean {
  if (!urlStr) return false;
  try {
    const parsed = new URL(urlStr);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
