const HISTORY_KV_KEY = 'guild-history';
const SHARD_RESOURCE_ID = '2';
const MIN_SAVE_INTERVAL_MS = 120000; // Only save at most once per 2 minutes

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = buildCorsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname === '/api/reset-history') {
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (!env.GUILD_HISTORY) {
        return new Response(JSON.stringify({ error: 'History store unavailable' }), {
          status: 501,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      try {
        await env.GUILD_HISTORY.delete(HISTORY_KV_KEY);
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          error: 'Failed to reset history',
          details: error instanceof Error ? error.message : String(error)
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

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
            cacheTtl: 15  // Reduced to 15 seconds to match refresh rate options
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
        const nowIso = new Date().toISOString();

        const previousHistory = await loadHistory(env);
        const updatedHistory = applyUpdates(previousHistory, data, nowIso);
        
        // Build history from the updated history so users see the latest changes
        const potionHistory = buildPotionHistory(updatedHistory, data);
        const contributionHistory = buildContributionHistory(updatedHistory, data);
        
        // Only save if data actually changed AND enough time has passed since last save
        if (hasHistoryChanged(previousHistory, updatedHistory) && shouldSave(previousHistory)) {
          ctx.waitUntil(saveHistory(env, updatedHistory));
        }

        data.potion_history = potionHistory;
        data.contribution_history = contributionHistory;

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
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
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

async function loadHistory(env) {
  if (!env.GUILD_HISTORY) {
    return createEmptyHistory();
  }

  const raw = await env.GUILD_HISTORY.get(HISTORY_KV_KEY);
  if (!raw) {
    return createEmptyHistory();
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to parse stored history. Resetting.', error);
    return createEmptyHistory();
  }
}

async function saveHistory(env, history) {
  if (!env.GUILD_HISTORY) {
    return;
  }

  await env.GUILD_HISTORY.put(HISTORY_KV_KEY, JSON.stringify(history));
}

function createEmptyHistory() {
  return {
    last_update: null,
    members: {},
    guild_funds: {},
    guild_funds_timestamp: null,
    member_shard_events: {},
    guild_shard_events: []
  };
}

function buildPotionHistory(history, currentData) {
  const result = {};
  if (!history?.members || !currentData?.Members) {
    return result;
  }

  for (const [memberId, member] of Object.entries(currentData.Members)) {
    const prevMember = history.members[String(memberId)];
    if (!prevMember) continue;

    const potionHistory = prevMember.PotionHistory || {};
    if (Object.keys(potionHistory).length > 0) {
      result[memberId] = clone(potionHistory);
    }
  }

  return result;
}

function buildContributionHistory(history, currentData) {
  const result = {};
  if (!history) {
    return result;
  }

  if (history.guild_funds) {
    result.guild_funds = clone(history.guild_funds);
  }
  if (history.guild_funds_timestamp) {
    result.guild_funds_timestamp = history.guild_funds_timestamp;
  }
  if (history.guild_shard_events) {
    result.guild_shard_events = clone(history.guild_shard_events);
  }
  if (history.member_shard_events) {
    result.member_shard_events = clone(history.member_shard_events);
  }

  if (!history.members || !currentData?.Members) {
    return result;
  }

  for (const [memberId, member] of Object.entries(currentData.Members)) {
    const prevMember = history.members[String(memberId)];
    if (!prevMember) continue;

    result[memberId] = {
      Contributions: clone(prevMember.Contributions || {}),
      last_update: prevMember.last_update || history.last_update
    };
  }

  return result;
}

function applyUpdates(previousHistory, currentData, nowIso) {
  const history = deepCloneHistory(previousHistory);
  updatePotionHistory(history, currentData, nowIso);
  updateContributionHistory(history, currentData, nowIso);
  history.last_update = nowIso;
  return history;
}

function updatePotionHistory(history, currentData, nowIso) {
  if (!currentData?.Members) {
    return;
  }

  const members = (history.members = history.members || {});

  for (const [memberId, member] of Object.entries(currentData.Members)) {
    const memberIdStr = String(memberId);
    const currentPotions = member.Potions || {};
    let entry = members[memberIdStr];
    const isNewMember = !entry;

    if (!entry) {
      entry = members[memberIdStr] = {
        Name: member.Name || 'Unknown',
        Potions: {},
        PotionHistory: {}
      };
    }

    entry.PotionHistory = entry.PotionHistory || {};
    const previousPotions = entry.Potions || {};
    const allPotionIds = new Set([
      ...Object.keys(previousPotions),
      ...Object.keys(currentPotions)
    ]);

    for (const potionId of allPotionIds) {
      const prevAmt = getNumber(previousPotions[potionId]);
      const currAmt = getNumber(currentPotions[potionId]);

      if (!isNewMember && prevAmt !== currAmt) {
        if (!entry.PotionHistory[potionId]) {
          entry.PotionHistory[potionId] = [];
        }
        entry.PotionHistory[potionId].push({
          amount: prevAmt,
          timestamp: nowIso
        });
      }
    }

    entry.Potions = clone(currentPotions);
  }
}

function updateContributionHistory(history, currentData, nowIso) {
  const members = (history.members = history.members || {});
  const memberShardEvents = (history.member_shard_events = history.member_shard_events || {});
  history.guild_shard_events = history.guild_shard_events || [];

  if (currentData?.Funds) {
    const fundsChanged = hasFundsChanged(history.guild_funds, currentData.Funds);
    if (history.guild_funds && fundsChanged) {
      const prevShards = getResourceValue(history.guild_funds, SHARD_RESOURCE_ID);
      const currShards = getResourceValue(currentData.Funds, SHARD_RESOURCE_ID);
      const diff = currShards - prevShards;
      // Only record guild shard events if we had shards in previous snapshot
      // If prevShards is 0, we're establishing baseline after reset and diff would be total
      if (prevShards > 0 && diff > 0.01) {
        history.guild_shard_events.push({
          timestamp: nowIso,
          amount: diff
        });
      }
    }

    if (fundsChanged || !history.guild_funds) {
      history.guild_funds = clone(currentData.Funds);
      history.guild_funds_timestamp = nowIso;
    }
  }

  if (!currentData?.Members) {
    return;
  }

  for (const [memberId, member] of Object.entries(currentData.Members)) {
    const memberIdStr = String(memberId);
    let entry = members[memberIdStr];
    const isNewMember = !entry;

    if (!entry) {
      entry = members[memberIdStr] = {
        Name: member.Name || 'Unknown',
        Contributions: {},
        last_update: nowIso,
        Potions: {},
        PotionHistory: {}
      };
    }

    const currentContributions = clone(member.Contributions || {});
    const previousContributions = entry.Contributions || {};

    const prevShards = getResourceValue(previousContributions, SHARD_RESOURCE_ID);
    const currShards = getResourceValue(currentContributions, SHARD_RESOURCE_ID);
    const shardDiff = currShards - prevShards;

    // Only record shard events if the member had shards in a previous snapshot
    // If prevShards is 0, we're establishing baseline (either new member or after reset)
    // and the diff would be the total, not a real drop - so we don't record it
    // Once prevShards > 0, we know we have a baseline and can track actual changes
    const hasValidPreviousData = prevShards > 0;

    if (!isNewMember && hasValidPreviousData && shardDiff > 0.01) {
      const events = (memberShardEvents[memberIdStr] = memberShardEvents[memberIdStr] || []);
      events.push({ timestamp: nowIso, amount: shardDiff });
    }

    let contributionsChanged = isNewMember;
    if (!contributionsChanged) {
      const allResourceIds = new Set([
        ...Object.keys(previousContributions),
        ...Object.keys(currentContributions)
      ]);
      for (const resourceId of allResourceIds) {
        const prevValue = getNumber(previousContributions[resourceId]);
        const currValue = getNumber(currentContributions[resourceId]);
        if (Math.abs(currValue - prevValue) > 0.01) {
          contributionsChanged = true;
          break;
        }
      }
    }

    entry.Contributions = currentContributions;
    if (contributionsChanged) {
      entry.last_update = nowIso;
    }
  }
}

function hasFundsChanged(previousFunds, currentFunds) {
  if (!previousFunds) {
    return true;
  }

  const allIds = new Set([
    ...Object.keys(previousFunds),
    ...Object.keys(currentFunds)
  ]);

  for (const id of allIds) {
    const prev = getNumber(previousFunds[id]);
    const curr = getNumber(currentFunds[id]);
    if (Math.abs(curr - prev) > 0.01) {
      return true;
    }
  }

  return false;
}

function getResourceValue(container, resourceId) {
  if (!container) {
    return 0;
  }

  if (resourceId in container) {
    return getNumber(container[resourceId]);
  }

  const resourceIdStr = String(resourceId);
  if (resourceIdStr in container) {
    return getNumber(container[resourceIdStr]);
  }

  const resourceIdInt = Number(resourceIdStr);
  if (Number.isFinite(resourceIdInt) && resourceIdInt in container) {
    return getNumber(container[resourceIdInt]);
  }

  return 0;
}

function getNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function deepCloneHistory(history) {
  if (!history) {
    return createEmptyHistory();
  }

  return JSON.parse(JSON.stringify(history));
}

function hasHistoryChanged(previous, updated) {
  if (!previous || !updated) {
    return true;
  }

  // Compare member counts
  const prevMemberCount = Object.keys(previous.members || {}).length;
  const updatedMemberCount = Object.keys(updated.members || {}).length;
  if (prevMemberCount !== updatedMemberCount) {
    return true;
  }

  // Create copies without last_update for comparison (since it always changes)
  const prevCompare = { ...previous, last_update: null };
  const updatedCompare = { ...updated, last_update: null };
  
  // Quick JSON comparison (most reliable)
  return JSON.stringify(prevCompare) !== JSON.stringify(updatedCompare);
}

function shouldSave(history) {
  // If no previous history, always save
  if (!history || !history.last_update) {
    return true;
  }

  // Check if enough time has passed since last save
  const lastUpdateTime = new Date(history.last_update).getTime();
  const now = Date.now();
  const timeSinceLastSave = now - lastUpdateTime;

  // Only save if at least MIN_SAVE_INTERVAL_MS has passed
  return timeSinceLastSave >= MIN_SAVE_INTERVAL_MS;
}

