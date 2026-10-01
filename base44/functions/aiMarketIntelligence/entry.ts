import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * AI Market Intelligence — fetches real-time news, social, and on-chain
 * sentiment for a single cryptocurrency via live web search.
 *
 * Narrow, app-specific operation: the client sends only { symbol, name };
 * the prompt is constructed entirely server-side. The client never sends
 * a raw prompt, preventing prompt-injection abuse of integration credits.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Require authentication — prevents anonymous credit consumption.
    try {
      await base44.auth.me();
    } catch {
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { symbol, name } = await req.json();

    if (!symbol || !name) {
      return Response.json({ error: 'symbol and name required' }, { status: 400 });
    }

    // Sanitize inputs — only alphanumeric + a few separators.
    const cleanSymbol = String(symbol).replace(/[^A-Za-z0-9/-]/g, '').slice(0, 20);
    const cleanName = String(name).replace(/[^A-Za-z0-9 .-]/g, '').slice(0, 80);

    // Construct the prompt server-side — client never controls the prompt text.
    const prompt = `Search the web for real-time data about the cryptocurrency ${cleanName} (${cleanSymbol}) from the last 24 hours. Provide three analyses based ONLY on what you actually find via web search:

1. NEWS SENTIMENT: 3 actual recent headlines you found, an overall sentiment score from -1 (very bearish) to 1 (very bullish), a sentiment label, the impact level, a brief summary, and the source name for each headline.

2. SOCIAL MEDIA SENTIMENT: Based on real Twitter/X, Reddit, and crypto forums data, return a social score (0-100), mention volume, a sentiment breakdown (positive/neutral/negative percentages summing to 100), up to 3 real trending topics or hashtags, influencer sentiment, and engagement level.

3. ON-CHAIN METRICS: Based on real on-chain data, return an on-chain score (0-100), whale activity, exchange flow, network health %, a holder distribution summary, key metrics (active addresses, transaction volume in USD, large tx count), and an overall on-chain signal.

Do not invent data; if little is found for any section, reflect that in conservative values.`;

    const response = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      add_context_from_internet: true,
      model: 'gemini_3_flash',
      response_json_schema: {
        type: 'object',
        properties: {
          news: {
            type: 'object',
            properties: {
              sentiment_score: { type: 'number' },
              sentiment_label: { type: 'string', enum: ['very_bearish', 'bearish', 'neutral', 'bullish', 'very_bullish'] },
              key_headlines: { type: 'array', items: { type: 'string' } },
              impact_level: { type: 'string', enum: ['low', 'medium', 'high'] },
              summary: { type: 'string' },
              sources: { type: 'array', items: { type: 'string' } },
            },
          },
          social: {
            type: 'object',
            properties: {
              social_score: { type: 'number' },
              mention_volume: { type: 'string', enum: ['high', 'moderate', 'low'] },
              sentiment_breakdown: {
                type: 'object',
                properties: {
                  positive: { type: 'number' },
                  neutral: { type: 'number' },
                  negative: { type: 'number' },
                },
              },
              trending_topics: { type: 'array', items: { type: 'string' } },
              influencer_sentiment: { type: 'string', enum: ['bullish', 'mixed', 'bearish'] },
              engagement_level: { type: 'string', enum: ['viral', 'high', 'moderate', 'low'] },
            },
          },
          onchain: {
            type: 'object',
            properties: {
              onchain_score: { type: 'number' },
              whale_activity: { type: 'string', enum: ['accumulating', 'distributing', 'neutral'] },
              exchange_flow: { type: 'string', enum: ['net_inflow', 'net_outflow', 'balanced'] },
              network_health: { type: 'number' },
              holder_distribution: { type: 'string' },
              key_metrics: {
                type: 'object',
                properties: {
                  active_addresses: { type: 'number' },
                  transaction_volume: { type: 'number' },
                  large_transactions: { type: 'number' },
                },
              },
              signal: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
            },
          },
        },
      },
    });

    // Normalize — clamp ranges and fill defaults so the client gets clean data.
    const news = {
      sentiment_score: Math.max(-1, Math.min(1, response.news?.sentiment_score || 0)),
      sentiment_label: response.news?.sentiment_label || 'neutral',
      key_headlines: (response.news?.key_headlines || []).slice(0, 3),
      impact_level: response.news?.impact_level || 'medium',
      summary: response.news?.summary || '',
      sources: response.news?.sources || [],
    };

    const social = {
      social_score: Math.max(0, Math.min(100, response.social?.social_score || 50)),
      mention_volume: response.social?.mention_volume || 'low',
      sentiment_breakdown: {
        positive: Math.round(response.social?.sentiment_breakdown?.positive ?? 33),
        neutral: Math.round(response.social?.sentiment_breakdown?.neutral ?? 34),
        negative: Math.round(response.social?.sentiment_breakdown?.negative ?? 33),
      },
      trending_topics: (response.social?.trending_topics || []).slice(0, 3),
      influencer_sentiment: response.social?.influencer_sentiment || 'mixed',
      engagement_level: response.social?.engagement_level || 'low',
    };

    const onchain = {
      onchain_score: Math.max(0, Math.min(100, response.onchain?.onchain_score || 50)),
      whale_activity: response.onchain?.whale_activity || 'neutral',
      exchange_flow: response.onchain?.exchange_flow || 'balanced',
      network_health: Math.max(0, Math.min(100, response.onchain?.network_health ?? 70)),
      holder_distribution: response.onchain?.holder_distribution || 'No distribution data available from live sources.',
      key_metrics: {
        active_addresses: response.onchain?.key_metrics?.active_addresses || 0,
        transaction_volume: response.onchain?.key_metrics?.transaction_volume || 0,
        large_transactions: response.onchain?.key_metrics?.large_transactions || 0,
      },
      signal: response.onchain?.signal || 'neutral',
    };

    return Response.json({ success: true, news, social, onchain });
  } catch (error) {
    console.error('AI Market Intelligence Error:', error);
    return Response.json({ error: 'Market intelligence unavailable' }, { status: 500 });
  }
});