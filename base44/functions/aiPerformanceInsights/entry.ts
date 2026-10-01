import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * AI Performance Insights — analyzes a trader's historical performance
 * and provides actionable advisor insights.
 *
 * Narrow, app-specific operation: the client sends pre-computed performance
 * metrics, issues, and asset analysis; the prompt is constructed entirely
 * server-side. No web search (keeps credit cost low).
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
      metrics = {},
      issues = [],
      bestPerformers = [],
      worstPerformers = [],
      settings = {},
      personalizedContext = '',
    } = await req.json();

    if (!metrics || metrics.totalTrades == null) {
      return Response.json({ error: 'metrics required' }, { status: 400 });
    }

    // Build the prompt server-side from structured data.
    const issuesText = Array.isArray(issues) && issues.length > 0
      ? issues.map((i) => `- ${i.description || ''}`).join('\n')
      : '- No critical issues detected';

    const bestText = Array.isArray(bestPerformers) && bestPerformers.length > 0
      ? bestPerformers.map((a) => `- ${a.symbol}: ${a.trades} trades, $${Number(a.totalPnL || 0).toFixed(2)} P&L, ${Number(a.winRate || 0).toFixed(0)}% win rate`).join('\n')
      : '- No data';

    const worstText = Array.isArray(worstPerformers) && worstPerformers.length > 0
      ? worstPerformers.map((a) => `- ${a.symbol}: ${a.trades} trades, $${Number(a.totalPnL || 0).toFixed(2)} P&L, ${Number(a.winRate || 0).toFixed(0)}% win rate`).join('\n')
      : '- No data';

    const prompt = `As an expert trading advisor, analyze this trader's performance and provide actionable insights:

**Performance Metrics:**
- Total Trades: ${metrics.totalTrades}
- Win Rate: ${metrics.winRate}%
- Profit Factor: ${metrics.profitFactor}
- Net P&L: $${metrics.netPnL}
- Max Drawdown: ${metrics.maxDrawdown}%
- Average Win: $${metrics.avgWin}
- Average Loss: $${metrics.avgLoss}

**Current Issues:**
${issuesText}

**Top Performing Assets:**
${bestText}

**Worst Performing Assets:**
${worstText}

**Current Settings:**
- Min Confidence: ${settings?.min_confidence || 70}%
- Stop Loss: ${settings?.stop_loss_percent || 3}%
- Take Profit: ${settings?.take_profit_percent || 8}%
- Position Size: ${settings?.max_position_size_percent || 10}%
- Trailing Stop: ${settings?.use_trailing_stop ? 'Enabled' : 'Disabled'}

${personalizedContext ? `**User Preferences:**\n${personalizedContext}` : ''}

Provide:
1. A clear assessment of trading performance (2-3 sentences) - tailor it to their trading style and preferences
2. Top 3 specific actions to improve results - aligned with their risk tolerance and goals
3. Asset allocation recommendations - consider their preferred and excluded assets
4. Risk management advice - match their risk tolerance level
5. New market opportunities - filtered by their preferences (market cap, volatility, etc.)`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      add_context_from_internet: false,
      response_json_schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          performance_grade: { type: 'string', enum: ['excellent', 'good', 'fair', 'poor', 'critical'] },
          key_strengths: { type: 'array', items: { type: 'string' } },
          critical_issues: { type: 'array', items: { type: 'string' } },
          top_3_actions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string' },
                reason: { type: 'string' },
                expected_impact: { type: 'string' },
              },
            },
          },
          asset_recommendations: {
            type: 'object',
            properties: {
              focus_on: { type: 'array', items: { type: 'string' } },
              avoid: { type: 'array', items: { type: 'string' } },
              reasoning: { type: 'string' },
            },
          },
          risk_advice: { type: 'string' },
          opportunities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                asset: { type: 'string' },
                opportunity_type: { type: 'string' },
                confidence: { type: 'number' },
                reasoning: { type: 'string' },
              },
            },
          },
          personalization_note: {
            type: 'string',
            description: 'A note about how recommendations were tailored to user preferences',
          },
        },
      },
    });

    return Response.json({ success: true, ...result });
  } catch (error) {
    console.error('AI Performance Insights Error:', error);
    return Response.json({ error: 'Performance insights unavailable' }, { status: 500 });
  }
});