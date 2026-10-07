// LIVING IN SYNC — Cloudflare Worker + Static Assets
const SUPABASE_ORIGIN = 'https://uizkojxjiemotgkbrtlfn.supabase.co';
const PROXY_PREFIX = '/api/supabase';

function corsHeaders(origin) {
  const h = new Headers();
  h.set('Access-Control-Allow-Origin', origin || '*');
  h.set(
    'Access-Control-Allow-Methods',
    'GET,POST,PATCH,PUT,DELETE,OPTIONS'
  );
  h.set(
    'Access-Control-Allow-Headers',
    'apikey, authorization, content-type, prefer, x-client-info, range'
  );
  h.set(
    'Access-Control-Expose-Headers',
    'content-range, x-supabase-api-version'
  );
  h.set('Vary', 'Origin');
  return h;
}

function jsonError(origin, status, code, message) {
  const headers = corsHeaders(origin);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');

  return new Response(
    JSON.stringify({
      error: code,
      message
    }),
    {
      status,
      headers
    }
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Only proxy the Supabase API path.
    // Everything else is served by Cloudflare Pages Static Assets.
    if (
      url.pathname !== PROXY_PREFIX &&
      !url.pathname.startsWith(PROXY_PREFIX + '/')
    ) {
      if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
        return new Response(
          'Cloudflare Pages ASSETS binding is missing. Deploy this repo as a Pages project with _worker.js in the output directory.',
          {
            status: 500,
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-store'
            }
          }
        );
      }

      const assetResponse = await env.ASSETS.fetch(request);

      // Prevent the main HTML from being cached during MVP development.
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const h = new Headers(assetResponse.headers);
        h.set(
          'Cache-Control',
          'no-store, no-cache, must-revalidate'
        );
        h.set('Pragma', 'no-cache');

        return new Response(assetResponse.body, {
          status: assetResponse.status,
          statusText: assetResponse.statusText,
          headers: h
        });
      }

      return assetResponse;
    }

    const origin = request.headers.get('Origin') || '*';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      const headers = corsHeaders(origin);
      headers.set('Access-Control-Max-Age', '86400');

      return new Response(null, {
        status: 204,
        headers
      });
    }

    // Convert:
    // /api/supabase/auth/v1/...
    // into:
    // https://uizkojxjiemotgkbrtlfn.supabase.co/auth/v1/...
    const suffix =
      url.pathname.slice(PROXY_PREFIX.length) || '/';

    const target = new URL(
      SUPABASE_ORIGIN + suffix
    );

    target.search = url.search;

    const headers = new Headers(request.headers);

    // Let fetch determine the host and content length.
    headers.delete('host');
    headers.delete('content-length');

    let upstream;

    try {
      upstream = await fetch(target.toString(), {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method)
          ? undefined
          : request.body,
        redirect: 'follow'
      });
    } catch (error) {
      return jsonError(
        origin,
        502,
        'supabase_proxy_failed',
        String(error?.message || error)
      );
    }

    const responseHeaders = new Headers(
      upstream.headers
    );

    const cors = corsHeaders(origin);

    for (const [key, value] of cors.entries()) {
      responseHeaders.set(key, value);
    }

    responseHeaders.set(
      'Cache-Control',
      'no-store'
    );

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  }
};
