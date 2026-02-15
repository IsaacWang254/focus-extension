/**
 * Focus Extension Proxy Worker
 * 
 * Handles Todoist OAuth token exchange so the client_secret
 * never leaves the server. Secrets are stored as Cloudflare
 * Worker environment variables (wrangler secrets).
 *
 * Endpoints:
 *   POST /api/todoist/token   — exchange auth code for access token
 *   GET  /health              — health check
 */

// Allowed origins — update this with your extension's ID once published
const ALLOWED_ORIGINS = [
  'chrome-extension://'  // allows any extension origin during dev
];

/**
 * Check if the request origin is allowed
 */
function isAllowedOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  return origin.startsWith('chrome-extension://');
}

/**
 * Build CORS headers for the response
 */
function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * JSON error response helper
 */
function errorResponse(message, status, request) {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders(request),
      },
    }
  );
}

/**
 * Handle the Todoist token exchange
 */
async function handleTokenExchange(request, env) {
  // Parse request body
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400, request);
  }

  const { code } = body;
  if (!code) {
    return errorResponse('Missing required field: code', 400, request);
  }

  // Validate that secrets are configured
  if (!env.TODOIST_CLIENT_ID || !env.TODOIST_CLIENT_SECRET) {
    console.error('Todoist secrets not configured');
    return errorResponse('Server misconfiguration', 500, request);
  }

  // Exchange the authorization code for an access token
  const tokenResponse = await fetch('https://todoist.com/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: env.TODOIST_CLIENT_ID,
      client_secret: env.TODOIST_CLIENT_SECRET,
      code: code,
    }),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error('Todoist token exchange failed:', errorText);
    return errorResponse('Token exchange failed', tokenResponse.status, request);
  }

  const tokenData = await tokenResponse.json();

  // Only return the access token — never leak the secret
  return new Response(
    JSON.stringify({ access_token: tokenData.access_token }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders(request),
      },
    }
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request),
      });
    }

    // Health check
    if (url.pathname === '/health' && request.method === 'GET') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Token exchange endpoint
    if (url.pathname === '/api/todoist/token' && request.method === 'POST') {
      // Verify the request is from our extension
      if (!isAllowedOrigin(request)) {
        return errorResponse('Forbidden', 403, request);
      }

      return handleTokenExchange(request, env);
    }

    // 404 for everything else
    return errorResponse('Not found', 404, request);
  },
};
