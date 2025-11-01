const HISTORY_KV_KEY = 'guild-history';
const SHARD_RESOURCE_ID = '2';

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
        const potionHistory = buildPotionHistory(previousHistory, data);
        const contributionHistory = buildContributionHistory(previousHistory, data);

        const updatedHistory = applyUpdates(previousHistory, data, nowIso);
        ctx.waitUntil(saveHistory(env, updatedHistory));

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
    guild_shard_events: [],
    smoothed_rates: {} // Store smoothed per-hour rates per member per resource
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

  // Include smoothed rates in response
  if (history.smoothed_rates) {
    result.smoothed_rates = clone(history.smoothed_rates);
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
  // Calculate rates BEFORE updating contributions, so we have the old values to compare against
  calculateAndStoreRates(history, currentData, nowIso);
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
    // Always update last_update so rate calculations have accurate time, even if contributions didn't change
    // This ensures we can calculate correct rates based on time elapsed
    entry.last_update = nowIso;
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

// Calculate per-minute rate from contribution change
function calculatePerMinute(currentValue, previousValue, minutesElapsed) {
  if (minutesElapsed <= 0) return null;
  const diff = currentValue - previousValue;
  return diff / minutesElapsed;
}

// Convert per-minute to per-hour
function calculatePerHourFromPerMinute(perMinute) {
  if (perMinute === null) return null;
  return perMinute * 60;
}

// Smooth per-hour rates using exponential moving average (EMA)
// Alpha controls smoothing: lower = more smooth (slower response), higher = less smooth (faster response)
// Use adaptive alpha based on time window to handle short intervals better
function smoothPerHourRate(newRate, previousRate, minutesElapsed) {
  if (newRate === null || newRate === undefined || Number.isNaN(newRate)) {
    return previousRate;
  }
  
  if (previousRate === null || previousRate === undefined || Number.isNaN(previousRate)) {
    return newRate;
  }
  
  // Adaptive alpha: use lower weight for very short intervals to reduce volatility
  // For intervals < 5 minutes, use stronger smoothing (lower alpha)
  // For longer intervals, use less smoothing (higher alpha) to respond faster
  let alpha;
  if (minutesElapsed < 5) {
    // Very short intervals: strong smoothing (alpha = 0.15)
    alpha = 0.15;
  } else if (minutesElapsed < 15) {
    // Short intervals: moderate smoothing (alpha = 0.25)
    alpha = 0.25;
  } else if (minutesElapsed < 60) {
    // Medium intervals: light smoothing (alpha = 0.4)
    alpha = 0.4;
  } else {
    // Long intervals: minimal smoothing (alpha = 0.6) to respond quickly
    alpha = 0.6;
  }
  
  // Exponential moving average: new_smooth = alpha * new + (1 - alpha) * previous
  return alpha * newRate + (1 - alpha) * previousRate;
}

// Calculate and store smoothed rates for all members and resources
function calculateAndStoreRates(history, currentData, nowIso) {
  if (!currentData?.Members || !history.members) {
    return;
  }

  const smoothedRates = (history.smoothed_rates = history.smoothed_rates || {});
  const now = new Date(nowIso);

  for (const [memberId, member] of Object.entries(currentData.Members)) {
    const memberIdStr = String(memberId);
    const historyMember = history.members[memberIdStr];
    
    if (!historyMember || !historyMember.last_update) {
      // No history, can't calculate rates yet
      continue;
    }

    const previousTime = new Date(historyMember.last_update);
    const diffMs = now - previousTime;
    const minutesElapsed = diffMs / (1000 * 60);
    
    if (minutesElapsed <= 0) {
      continue;
    }

    const currentContributions = member.Contributions || {};
    const previousContributions = historyMember.Contributions || {};
    
    // Ensure member entry exists in smoothed_rates
    if (!smoothedRates[memberIdStr]) {
      smoothedRates[memberIdStr] = {};
    }
    
    const memberRates = smoothedRates[memberIdStr];
    
    // Calculate rates for all resources that exist in either current or previous
    const allResourceIds = new Set([
      ...Object.keys(currentContributions),
      ...Object.keys(previousContributions)
    ]);
    
    for (const resourceId of allResourceIds) {
      // Skip shards - they're handled separately with rolling windows
      if (resourceId === SHARD_RESOURCE_ID) {
        continue;
      }
      
      const currentValue = getNumber(currentContributions[resourceId]);
      const previousValue = getNumber(previousContributions[resourceId]);
      
      // Only calculate if we have a previous value (established baseline)
      // Need to check if the resource existed in previous contributions, not just if value is 0
      const hadPreviousResource = Object.prototype.hasOwnProperty.call(previousContributions, resourceId);
      
      if (hadPreviousResource) {
        const perMinute = calculatePerMinute(currentValue, previousValue, minutesElapsed);
        const perHour = calculatePerHourFromPerMinute(perMinute);
        
        if (perHour !== null && !Number.isNaN(perHour)) {
          const previousCachedRate = memberRates[resourceId];
          
          // If calculated rate is 0 but we have a cached non-zero rate, preserve the cache
          if (perHour === 0 && previousCachedRate !== undefined && previousCachedRate !== 0 && !Number.isNaN(previousCachedRate)) {
            memberRates[resourceId] = previousCachedRate;
          } else {
            // Apply exponential moving average smoothing
            if (previousCachedRate !== undefined && previousCachedRate !== null && !Number.isNaN(previousCachedRate)) {
              memberRates[resourceId] = smoothPerHourRate(perHour, previousCachedRate, minutesElapsed);
            } else {
              // First calculation - use the raw rate (even if 0, so we track that there's no change)
              memberRates[resourceId] = perHour;
            }
          }
        } else if (previousCachedRate !== undefined) {
          // Preserve cached rate if calculation failed
          memberRates[resourceId] = previousCachedRate;
        } else {
          // No calculation possible and no cache - this is expected on first run
          // Don't set anything, will be null/undefined
        }
      }
    }
  }
}

