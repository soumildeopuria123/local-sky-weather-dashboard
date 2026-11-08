import { ValidationError } from '../db/locations.js';

const MAX_BODY_BYTES = 32 * 1024;

export async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new ValidationError('Request body is too large.', 'body_too_large', 413);
    }
    chunks.push(chunk);
  }

  if (size === 0) return {};

  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('Request body must be valid JSON.', 'invalid_json', 400);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ValidationError('Request body must be a JSON object.', 'invalid_body', 400);
  }

  return parsed;
}
