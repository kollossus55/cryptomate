import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * AI Asset Analysis — comprehensive trading analysis for a single asset.
 *
 * Narrow, app-specific operation: the client sends structured market data
 * { name, symbol, price, change24h, volume24h, marketCap }; the prompt is
 * constructed entirely server-side. No web search (keeps credit cost low).
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    try {
      await base44.auth.me();
    } catch {
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { name, symbol, price, change24h, volume24h, marketCap } = await req.json();

    if (!symbol || !name) {
      return Response.json({ error: 'name and symbol required' }, { status: 400 });
    }

    // Sanitize
    const cleanSymbol = String(symbol).replace(/[^A-Za-z0-9/-]/g, '').slice(0, 20);
    const cleanName = String(name).replace(/[^A-Za-z0-9 .-]/g, '').slice(0, 80);
    const safePrice = Number(price) || 0;
    const safeChange = Number(change24h) || 0;
    const safeVolume = Number(volume24h) || 0;
    const safeMarketCap = Number(marketCap) || 0;

    const prompt = `Provide a comprehensive trading analysis for ${cleanName} (${cleanSymbol}).

Current market data:
- Price: $${safePrice}
- 24h Change: ${safeChange}%
- Volume: $${safeVolume}
- Market Cap: $${safeMarketCap}

Analyze:
1. Technical indicators and chart patterns
2. Recent news and market sentiment
3. Social media trends and community sentiment
4. On-chain metrics and whale activity
5. Overall market conditions

Provide detailed trading recommendations with confidence scores.`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      add_context_from_internet: false,
      response_json_schema: {
        type: 'object',
        properties: {
          sentiment: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
          confidence: { type: 'number' },
          recommendation: { type: 'string', enum: ['buy', 'sell', 'hold'] },
          technical_indicators: { type: 'array', items: { type: 'string' } },
          support_level: { type: 'number' },
          resistance_level: { type: 'number' },
          price_targets: {
            type: 'object',
            properties: {
              short_term: { type: 'number' },
              medium_term: { type: 'number' },
            },
          },
          risk_level: { type: 'string', enum: ['low', 'medium', 'high'] },
          key_insights: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
        },
      },
    });

    return Response.json({ success: true, analysis: result });
  } catch (error) {
    console.error('AI Asset Analysis Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});