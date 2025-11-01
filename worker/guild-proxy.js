export default {
  async fetch(request, env) {
    const corsHeaders = buildCorsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/guild/')) {
      const guildId = url.pathname.split('/').pop();

      if (!guildId) {
        return new Response(JSON.stringify({ error: 'Guild ID required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const upstreamUrl = `https://api.manarion.com/guilds/${guildId}?apikey=${env.MANARION_API_KEY}`;

      try {
        const upstreamResponse = await fetch(upstreamUrl, {
          cf: {
            cacheEverything: true,
            cacheTtl: 60
          },
          headers: {
            'Accept': 'application/json'
          }
        });

        if (!upstreamResponse.ok) {
          const errorBody = await safeJson(upstreamResponse);
          return new Response(JSON.stringify({
            error: 'Upstream API request failed',
            status: upstreamResponse.status,
            details: errorBody
          }), {
            status: upstreamResponse.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const data = await upstreamResponse.json();

        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          error: 'Worker request failed',
          details: error instanceof Error ? error.message : String(error)
        }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });
  }
};

function buildCorsHeaders(request) {
  const origin = request.headers.get('Origin');
  const allowedOrigin = origin || '*';

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return await response.text();
  }
}

