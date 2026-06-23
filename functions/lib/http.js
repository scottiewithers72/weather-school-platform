// Tiny response helpers for Netlify functions.
export const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  },
  body: JSON.stringify(body)
});

export const ok = (body) => json(200, body);
export const bad = (msg, code = 400) => json(code, { error: msg });

export function handle(fn) {
  return async (event, context) => {
    if (event.httpMethod === 'OPTIONS') return json(204, {});
    try {
      return await fn(event, context);
    } catch (e) {
      const code = e.statusCode || 500;
      if (code === 500) console.error(e);
      return bad(code === 500 ? 'Server error' : e.message, code);
    }
  };
}

export const parseBody = (event) => {
  try { return JSON.parse(event.body || '{}'); } catch { return {}; }
};
