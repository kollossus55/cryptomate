import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * AI Trading Recommendations — analyzes a basket of assets + portfolio
 * positions to produce top trading opportunities.
 *
 * Narrow, app-specific operation: the client sends structured data
 * (assets, positions, preferences); the prompt is constructed entirely
 * server-side. The client never sends a raw prompt string.
 *
 * useWebSearch controls whether the LLM uses live web context (costs more
 * credits) or relies only on the provided market data.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    try {
      await base44.auth.me();
    } catch {
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    const {
      assets = [],
      positions = [],
      preferences = {},
      maxRecommendations = 5,
      useWebSearch = false,
    } = await req.json();

    if (!Array.isArray(assets) || assets.length === 0) {
      return Response.json({ error: 'assets array required' }, { status: 400 });
    }

    // Cap to prevent abuse
    const cappedAssets = assets.slice(0, 20);
    const cappedMax = Math.min(Math.max(Number(maxRecommendations) || 5, 1), 10);

    // Build the assets data string server-side from structured input.
    const assetsData = cappedAssets.map((asset) => {
      const parts = [`${asset.name} (${asset.symbol}): Price $${asset.price}, 24h Change ${asset.change24h}%, Volume $${((asset.volume24h || 0) / 1e9).toFixed(2)}B`];
      if (asset.sp500ai) {
        const sp = asset.sp500ai;
        parts.push(`SP500 AI: ${sp.longSignal ? 'LONG' : sp.shortSignal ? 'SHORT' : 'neutral'} (strength ${sp.strength}/${sp.maxStrength})${sp.sp500ai_blocked ? ' [BLOCKED]' : ''}`);
      }
      if (asset.confidence != null) {
        parts.push(`Tech Confidence: ${asset.confidence}% (${asset.recommendation || 'hold'})`);
      }
      return parts.join(', ');
    }).join('\n');

    // Build positions data server-side.
    const positionsData = Array.isArray(positions) && positions.length > 0
      ? positions.map((pos) => {
          const symbol = String(pos.asset_symbol || '').replace('/USDT', '');
          const currentPrice = Number(pos.current_price) || 0;
          const profitPercent = pos.avg_entry_price > 0
            ? ((currentPrice - pos.avg_entry_price) / pos.avg_entry_price * 100).toFixed(2)
            : 0;
          return `${symbol}: Holding ${Number(pos.quantity || 0).toFixed(6)} @ $${Number(pos.avg_entry_price || 0).toFixed(2)} entry, Current $${currentPrice.toFixed(2)} (${profitPercent >= 0 ? '+' : ''}${profitPercent}% P&L)`;
        }).join('\n')
      : 'No open positions';

    const minConfidenceBuy = preferences?.signal_alert_thresholds?.min_confidence_buy ?? 70;
    const minConfidenceSell = preferences?.signal_alert_thresholds?.min_confidence_sell ?? 65;
    const riskTolerance = preferences?.risk_tolerance || 'moderate';
    const tradingStyle = preferences?.trading_style || 'balanced';

    // Check if any assets include SP500 AI data
    const hasSp500 = cappedAssets.some((a) => a.sp500ai);

    const prompt = `As an advanced AI trading system, analyze these cryptocurrencies using multi-factor analysis:

CURRENT PORTFOLIO POSITIONS:
${positionsData}

MARKET DATA:
${assetsData}

User Risk Tolerance: ${riskTolerance}
User Trading Style: ${tradingStyle}
Alert Thresholds: Buy signals minimum ${minConfidenceBuy}% confidence, Sell signals minimum ${minConfidenceSell}% confidence

Use comprehensive data sources:
1. **Technical Analysis**: Price momentum, volume, volatility patterns${hasSp500 ? ', AND the pre-computed SP500 AI indicator signals (Heikin Ashi, SSL Channel, CMO, AI RSI, TMO, AI Money Flow) shown per asset as "SP500 AI: LONG/SHORT/neutral (strength X/Y)". Prioritise assets where SP500 AI shows a LONG or SHORT signal with high strength. If an asset shows "SP500 AI: [BLOCKED]", do NOT recommend a buy on that asset.' : ''}

Recommend the BEST ${cappedMax} trading opportunities with:
- PRIORITIZE: Sell signals for assets user currently holds if they show weakness or profit-taking opportunity
- High conviction trades based on multiple confirming signals
- Detailed reasoning incorporating all data sources
- For held positions: Consider profit targets, risk of reversal, and optimal exit timing
- For new positions: Only recommend buy signals meeting the confidence threshold
- Risk assessment considering volatility and market conditions
- Realistic target prices based on support/resistance levels
- Ensure confidence levels meet user thresholds (${minConfidenceBuy}% for buys, ${minConfidenceSell}% for sells)

IMPORTANT:
- Include SELL opportunities for held positions if technical signals indicate exits
- Return confidence as a percentage from 0-100 (e.g., 85 not 0.85)
- Balance recommendations between buy/sell based on market conditions and portfolio

Return ONLY the top ${cappedMax} highest-conviction opportunities (can be mix of buy/sell).`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      add_context_from_internet: useWebSearch,
      ...(useWebSearch ? { model: 'gemini_3_flash' } : {}),
      response_json_schema: {
        type: 'object',
        properties: {
          recommendations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                symbol: { type: 'string' },
                action: { type: 'string', enum: ['buy', 'sell'] },
                confidence: { type: 'number' },
                reasoning: { type: 'string' },
                risk_level: { type: 'string', enum: ['low', 'medium', 'high'] },
                target_price: { type: 'number' },
                data_sources: {
                  type: 'object',
                  properties: {
                    technical_score: { type: 'number' },
                  },
                },
              },
            },
          },
          market_summary: { type: 'string' },
        },
      },
    });

    // Normalize confidence — if decimals (< 1), convert to percentage.
    if (result?.recommendations) {
      result.recommendations = result.recommendations.map((rec) => ({
        ...rec,
        confidence: rec.confidence < 1 ? Math.round(rec.confidence * 100) : Math.round(rec.confidence),
      }));
    }

    return Response.json({ success: true, ...result });
  } catch (error) {
    console.error('AI Trading Recommendations Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});