import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * Auto-Trading Worker V3 - Technical Analysis + AI Sentiment
 * 
 * PRIORITY ORDER:
 * 1. Technical Analysis (70% weight) - RSI, MACD, Trend, Support/Resistance
 * 2. AI Sentiment (30% weight) - News sentiment, market context
 * 
 * Technicals must pass first, then AI confirms or vetoes.
 */

const COINGECKO_IDS = {
  'BTC': 'bitcoin', 'ETH': 'ethereum', 'BNB': 'binancecoin', 'SOL': 'solana',
  'XRP': 'ripple', 'ADA': 'cardano', 'AVAX': 'avalanche-2', 'DOGE': 'dogecoin',
  'DOT': 'polkadot', 'MATIC': 'matic-network', 'LTC': 'litecoin', 'LINK': 'chainlink',
  'UNI': 'uniswap', 'ATOM': 'cosmos', 'XLM': 'stellar', 'ALGO': 'algorand',
  'NEAR': 'near', 'APT': 'aptos', 'ARB': 'arbitrum', 'OP': 'optimism',
  'INJ': 'injective-protocol', 'SUI': 'sui', 'SEI': 'sei-network'
};

// Fetch historical data from CoinGecko
async function fetchHistoricalData(coinId) {
  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=30&interval=daily`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!response.ok) return null;
    const data = await response.json();
    return {
      prices: (data.prices || []).map(p => p[1]),
      volumes: (data.total_volumes || []).map(v => v[1])
    };
  } catch (e) {
    return null;
  }
}

// Calculate RSI
function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }
  const recentChanges = changes.slice(-period);
  let gains = 0, losses = 0;
  recentChanges.forEach(change => {
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  });
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - (100 / (1 + rs));
}

// Calculate SMA
function calculateSMA(prices, period) {
  if (prices.length < period) return null;
  return prices.slice(-period).reduce((sum, p) => sum + p, 0) / period;
}

// Calculate EMA
function calculateEMA(prices, period) {
  if (prices.length < period) return null;
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  return ema;
}

// Calculate MACD
function calculateMACD(prices) {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  if (!ema12 || !ema26) return null;
  return { value: ema12 - ema26, bullish: ema12 > ema26 };
}

// Detect trend
function detectTrend(prices) {
  if (prices.length < 20) return 'neutral';
  const sma7 = calculateSMA(prices, 7);
  const sma20 = calculateSMA(prices, 20);
  const current = prices[prices.length - 1];
  
  if (current > sma7 && sma7 > sma20) return 'strong_uptrend';
  if (current > sma20) return 'uptrend';
  if (current < sma7 && sma7 < sma20) return 'strong_downtrend';
  if (current < sma20) return 'downtrend';
  return 'neutral';
}

// Calculate volatility
function calculateVolatility(prices) {
  if (prices.length < 14) return 5;
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.abs((prices[i] - prices[i-1]) / prices[i-1]) * 100);
  }
  return returns.slice(-14).reduce((sum, r) => sum + r, 0) / 14;
}

// Find support/resistance
function findSupportResistance(prices) {
  if (prices.length < 20) return null;
  const current = prices[prices.length - 1];
  const recentPrices = prices.slice(-30);
  
  let support = Math.min(...recentPrices);
  let resistance = Math.max(...recentPrices);
  
  return {
    support,
    resistance,
    distanceToSupport: ((current - support) / current) * 100,
    distanceToResistance: ((resistance - current) / current) * 100
  };
}

// MAIN TECHNICAL SCORING FUNCTION
function scoreTechnicals(symbol, prices, volumes, currentPrice, change24h) {
  let score = 50; // Start neutral
  const reasons = [];
  
  // 1. RSI Analysis (25 points max)
  const rsi = calculateRSI(prices);
  if (rsi !== null) {
    if (rsi < 30) {
      score += 25;
      reasons.push(`RSI oversold: ${rsi.toFixed(1)}`);
    } else if (rsi < 40) {
      score += 15;
      reasons.push(`RSI low: ${rsi.toFixed(1)}`);
    } else if (rsi > 70) {
      score -= 25;
      reasons.push(`RSI overbought: ${rsi.toFixed(1)} - AVOID`);
    } else if (rsi > 60) {
      score -= 10;
      reasons.push(`RSI elevated: ${rsi.toFixed(1)}`);
    } else {
      score += 5; // Neutral RSI is slightly positive
      reasons.push(`RSI neutral: ${rsi.toFixed(1)}`);
    }
  }
  
  // 2. Trend Analysis (20 points max)
  const trend = detectTrend(prices);
  if (trend === 'strong_uptrend') {
    score += 20;
    reasons.push('Strong uptrend');
  } else if (trend === 'uptrend') {
    score += 10;
    reasons.push('Uptrend');
  } else if (trend === 'strong_downtrend') {
    score -= 25;
    reasons.push('Strong downtrend - AVOID');
  } else if (trend === 'downtrend') {
    score -= 15;
    reasons.push('Downtrend');
  }
  
  // 3. MACD Analysis (15 points max)
  const macd = calculateMACD(prices);
  if (macd) {
    if (macd.bullish && macd.value > 0) {
      score += 15;
      reasons.push('MACD bullish');
    } else if (!macd.bullish) {
      score -= 15;
      reasons.push('MACD bearish');
    }
  }
  
  // 4. Support/Resistance (15 points max)
  const sr = findSupportResistance(prices);
  if (sr) {
    if (sr.distanceToSupport < 3) {
      score += 15;
      reasons.push(`Near support (${sr.distanceToSupport.toFixed(1)}% above)`);
    } else if (sr.distanceToSupport < 6) {
      score += 8;
      reasons.push('Approaching support');
    }
    if (sr.distanceToResistance < 3) {
      score -= 10;
      reasons.push(`Near resistance - limited upside`);
    }
  }
  
  // 5. Volatility Check (10 points max)
  const volatility = calculateVolatility(prices);
  if (volatility > 8) {
    score -= 15;
    reasons.push(`High volatility: ${volatility.toFixed(1)}% - RISKY`);
  } else if (volatility < 3) {
    score += 10;
    reasons.push('Low volatility');
  }
  
  // 6. Price vs Moving Averages (10 points max)
  const sma20 = calculateSMA(prices, 20);
  if (sma20) {
    const priceVsSma = ((currentPrice - sma20) / sma20) * 100;
    if (priceVsSma > 10) {
      score -= 10;
      reasons.push(`${priceVsSma.toFixed(1)}% above SMA20 - extended`);
    } else if (priceVsSma < -5 && trend !== 'strong_downtrend') {
      score += 10;
      reasons.push(`${Math.abs(priceVsSma).toFixed(1)}% below SMA20 - potential bounce`);
    }
  }
  
  // 7. Volume Confirmation (5 points max)
  if (volumes.length >= 7) {
    const recentVol = volumes.slice(-3).reduce((s,v) => s+v, 0) / 3;
    const olderVol = volumes.slice(-7, -3).reduce((s,v) => s+v, 0) / 4;
    if (recentVol > olderVol * 1.5 && trend?.includes('uptrend')) {
      score += 5;
      reasons.push('Volume confirming uptrend');
    }
  }
  
  // Clamp score
  score = Math.max(0, Math.min(100, score));
  
  // Determine action
  let action = 'hold';
  if (score >= 70) action = 'strong_buy';
  else if (score >= 60) action = 'buy';
  else if (score <= 30) action = 'strong_sell';
  else if (score <= 40) action = 'sell';
  
  return {
    symbol,
    score,
    action,
    rsi,
    trend,
    macd: macd?.bullish ? 'bullish' : 'bearish',
    volatility,
    reasons
  };
}

// Position sizing
function calculatePositionSize(balance, settings, price) {
  if (balance <= 0 || !price) return { valid: false };
  const maxSize = (settings.max_position_size_percent || 10) / 100;
  const value = Math.min(balance * maxSize, balance * 0.15);
  if (value < 10) return { valid: false, reason: 'too_small' };
  return { valid: true, value, quantity: value / price };
}

// AI Sentiment Analysis using LLM
async function analyzeAISentiment(base44, symbol, technicalData) {
  try {
    console.log(`  🤖 Fetching AI sentiment for ${symbol}...`);
    
    const prompt = `You are a crypto trading analyst. Analyze the current market sentiment for ${symbol}.

Technical Context:
- RSI: ${technicalData.rsi?.toFixed(1) || 'N/A'}
- Trend: ${technicalData.trend}
- MACD: ${technicalData.macd}
- Technical Score: ${technicalData.score}/100

Based on your knowledge of:
1. Recent news about ${symbol}
2. Overall crypto market sentiment
3. Any major events or announcements
4. Social media buzz and trader sentiment

Provide a sentiment analysis. Be concise and decisive.`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      add_context_from_internet: true,
      response_json_schema: {
        type: "object",
        properties: {
          sentiment: {
            type: "string",
            enum: ["very_bullish", "bullish", "neutral", "bearish", "very_bearish"],
            description: "Overall sentiment"
          },
          confidence: {
            type: "number",
            description: "Confidence in sentiment 0-100"
          },
          key_factors: {
            type: "array",
            items: { type: "string" },
            description: "Top 3 factors influencing sentiment"
          },
          recommendation: {
            type: "string",
            enum: ["strong_buy", "buy", "hold", "sell", "strong_sell"],
            description: "Trading recommendation based on sentiment"
          },
          risk_warning: {
            type: "string",
            description: "Any risk warnings or concerns"
          }
        },
        required: ["sentiment", "confidence", "recommendation"]
      }
    });
    
    console.log(`  ✅ AI Sentiment: ${result.sentiment} (${result.confidence}% confidence)`);
    console.log(`     Factors: ${result.key_factors?.slice(0, 2).join(', ') || 'N/A'}`);
    
    return result;
  } catch (error) {
    console.warn(`  ⚠️ AI sentiment failed: ${error.message}`);
    return {
      sentiment: 'neutral',
      confidence: 50,
      recommendation: 'hold',
      key_factors: ['Unable to fetch sentiment'],
      error: true
    };
  }
}

// Convert sentiment to score modifier (-30 to +30)
function sentimentToScore(sentiment) {
  const scores = {
    'very_bullish': 30,
    'bullish': 15,
    'neutral': 0,
    'bearish': -15,
    'very_bearish': -30
  };
  return scores[sentiment] || 0;
}

// Check if AI sentiment vetoes the trade
function shouldVetoTrade(aiSentiment, action) {
  if (!aiSentiment || aiSentiment.error) return false;
  
  // Veto buy if sentiment is bearish or very_bearish
  if (action === 'buy') {
    if (aiSentiment.sentiment === 'very_bearish') {
      console.log(`  ⛔ AI VETO: Very bearish sentiment blocks buy`);
      return true;
    }
    if (aiSentiment.sentiment === 'bearish' && aiSentiment.confidence >= 70) {
      console.log(`  ⛔ AI VETO: Strong bearish sentiment blocks buy`);
      return true;
    }
  }
  
  return false;
}

// Calculate combined score (Technical 70% + Sentiment 30%)
function calculateCombinedScore(technicalScore, aiSentiment) {
  const technicalWeight = 0.70;
  const sentimentWeight = 0.30;
  
  const sentimentModifier = sentimentToScore(aiSentiment?.sentiment || 'neutral');
  const sentimentScore = 50 + sentimentModifier; // Convert to 0-100 scale
  
  const combined = (technicalScore * technicalWeight) + (sentimentScore * sentimentWeight);
  
  return Math.round(Math.max(0, Math.min(100, combined)));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { settings, portfolio, user_email } = await req.json();
    
    if (!settings || !portfolio || !user_email) {
      return Response.json({ success: false, error: 'Missing parameters' }, { status: 400 });
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🤖 AUTO-TRADING V2 - Technical Analysis Mode`);
    console.log(`📧 User: ${user_email}`);
    console.log(`${'='.repeat(60)}`);
    
    // Reset daily counters if new day
    const lastTradeDate = settings.last_trade_date ? new Date(settings.last_trade_date).toDateString() : null;
    const today = new Date().toDateString();
    if (lastTradeDate && lastTradeDate !== today) {
      console.log(`📅 New day - resetting counters`);
      settings.trades_today = 0;
      settings.daily_loss = 0;
      settings.assets_traded_today = [];
      await base44.asServiceRole.entities.AutoTradingSettings.update(settings.id, {
        trades_today: 0, daily_loss: 0, assets_traded_today: []
      });
    }
    
    // Safety checks
    if (!settings.is_enabled) {
      return Response.json({ success: true, executed: false, reason: 'disabled' });
    }
    if ((settings.daily_loss || 0) >= (settings.max_daily_loss_percent || 5)) {
      return Response.json({ success: true, executed: false, reason: 'circuit_breaker' });
    }
    if ((settings.trades_today || 0) >= (settings.max_trades_per_day || 10)) {
      return Response.json({ success: true, executed: false, reason: 'trade_limit' });
    }
    
    console.log(`💰 Balance: $${portfolio.available_balance.toFixed(2)}`);
    console.log(`📊 Trades today: ${settings.trades_today || 0}/${settings.max_trades_per_day || 10}`);
    
    // Fetch current prices
    const ids = Object.values(COINGECKO_IDS).join(',');
    let marketData = {};
    try {
      const resp = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
        { headers: { 'Accept': 'application/json' } }
      );
      if (resp.ok) marketData = await resp.json();
    } catch (e) {
      console.warn('Failed to fetch prices');
    }
    
    // Check existing positions for stop-loss/take-profit first
    const opportunities = [];
    
    if (portfolio.positions?.length > 0) {
      console.log(`\n📦 Checking ${portfolio.positions.length} positions...`);
      
      for (const position of portfolio.positions) {
        const symbol = position.asset_symbol.replace('/USDT', '');
        const coinId = COINGECKO_IDS[symbol];
        const liveData = coinId ? marketData[coinId] : null;
        const currentPrice = liveData?.usd || position.avg_entry_price;
        const pnlPercent = ((currentPrice - position.avg_entry_price) / position.avg_entry_price) * 100;
        
        console.log(`  ${symbol}: Entry $${position.avg_entry_price.toFixed(2)} → Now $${currentPrice.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);
        
        // Stop-loss
        if (pnlPercent <= -(settings.stop_loss_percent || 3)) {
          opportunities.push({
            symbol, action: 'sell', reason: 'stop_loss',
            price: currentPrice, quantity: position.quantity, pnlPercent
          });
          console.log(`    ⛔ STOP-LOSS triggered`);
          break;
        }
        
        // Take-profit
        if (pnlPercent >= (settings.take_profit_percent || 8)) {
          opportunities.push({
            symbol, action: 'sell', reason: 'take_profit',
            price: currentPrice, quantity: position.quantity, pnlPercent
          });
          console.log(`    ✅ TAKE-PROFIT triggered`);
          break;
        }
      }
    }
    
    // Scan for buy opportunities if no sell signals
    if (opportunities.length === 0 && portfolio.available_balance > 50) {
      console.log(`\n🔍 Scanning for BUY opportunities...`);
      
      const candidates = [];
      const assetsTraded = settings.assets_traded_today || [];
      
      for (const [symbol, coinId] of Object.entries(COINGECKO_IDS)) {
        // Skip if already traded today or have position
        if (assetsTraded.includes(symbol)) continue;
        if (portfolio.positions?.find(p => p.asset_symbol === `${symbol}/USDT`)) continue;
        
        const liveData = marketData[coinId];
        if (!liveData?.usd) continue;
        
        // Fetch historical data for technical analysis
        const historical = await fetchHistoricalData(coinId);
        if (!historical || historical.prices.length < 14) continue;
        
        // Calculate technical score
        const technicals = scoreTechnicals(
          symbol,
          historical.prices,
          historical.volumes,
          liveData.usd,
          liveData.usd_24h_change || 0
        );
        
        console.log(`\n  📊 ${symbol}: Score ${technicals.score}/100 → ${technicals.action.toUpperCase()}`);
        console.log(`     RSI: ${technicals.rsi?.toFixed(1) || 'N/A'} | Trend: ${technicals.trend} | MACD: ${technicals.macd}`);
        console.log(`     Reasons: ${technicals.reasons.slice(0, 3).join(', ')}`);
        
        // Only consider if technical score >= 60 (gate check)
        if (technicals.score >= 60 && (technicals.action === 'buy' || technicals.action === 'strong_buy')) {
          const posSize = calculatePositionSize(portfolio.available_balance, settings, liveData.usd);
          if (posSize.valid) {
            candidates.push({
              symbol,
              action: 'buy',
              reason: technicals.action,
              price: liveData.usd,
              quantity: posSize.quantity,
              value: posSize.value,
              score: technicals.score,
              technicals
            });
          }
        }
        
        // Rate limit API calls
        await new Promise(r => setTimeout(r, 300));
      }
      
      // Sort by technical score and pick top 3 for AI sentiment analysis
      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        const topCandidates = candidates.slice(0, 3);
        
        console.log(`\n🎯 TOP ${topCandidates.length} TECHNICAL CANDIDATES:`);
        topCandidates.forEach((c, i) => {
          console.log(`   ${i+1}. ${c.symbol} - Technical Score: ${c.score}`);
        });
        
        // Get AI sentiment for top candidates
        console.log(`\n🤖 PHASE 2: AI SENTIMENT ANALYSIS`);
        
        let bestCandidate = null;
        let bestCombinedScore = 0;
        
        for (const candidate of topCandidates) {
          const aiSentiment = await analyzeAISentiment(base44, candidate.symbol, candidate.technicals);
          
          // Check for AI veto
          if (shouldVetoTrade(aiSentiment, 'buy')) {
            console.log(`   ${candidate.symbol}: VETOED by AI sentiment`);
            continue;
          }
          
          // Calculate combined score
          const combinedScore = calculateCombinedScore(candidate.score, aiSentiment);
          console.log(`   ${candidate.symbol}: Technical ${candidate.score} + AI ${aiSentiment.sentiment} = Combined ${combinedScore}`);
          
          if (combinedScore >= 65 && combinedScore > bestCombinedScore) {
            bestCombinedScore = combinedScore;
            bestCandidate = {
              ...candidate,
              score: combinedScore,
              aiSentiment,
              technicalScore: candidate.score
            };
          }
          
          // Small delay between AI calls
          await new Promise(r => setTimeout(r, 500));
        }
        
        if (bestCandidate) {
          opportunities.push(bestCandidate);
          console.log(`\n✅ SELECTED: ${bestCandidate.symbol}`);
          console.log(`   Technical: ${bestCandidate.technicalScore} | AI: ${bestCandidate.aiSentiment.sentiment} | Combined: ${bestCandidate.score}`);
        } else {
          console.log(`\n❌ All candidates vetoed or below threshold`);
        }
      }
    }
    
    // Execute trade if we have an opportunity
    if (opportunities.length === 0) {
      console.log(`\n❌ No opportunities met technical criteria`);
      return Response.json({ success: true, executed: false, reason: 'no_opportunities' });
    }
    
    const opp = opportunities[0];
    console.log(`\n🚀 EXECUTING: ${opp.action.toUpperCase()} ${opp.symbol}`);
    console.log(`   Quantity: ${opp.quantity.toFixed(6)} @ $${opp.price.toFixed(2)}`);
    
    // Create trade record
    const tradeData = {
      asset_symbol: `${opp.symbol}/USDT`,
      trade_type: opp.action,
      quantity: opp.quantity,
      price: opp.price,
      total_value: opp.quantity * opp.price,
      exchange: 'Paper Trading (Auto-V2)',
      status: 'completed',
      profit_loss: opp.pnlPercent ? (opp.price * opp.quantity) * (opp.pnlPercent / 100) : 0,
      ai_signal: {
        confidence: opp.score,
        reasoning: opp.technicals ? 
          `TECHNICALS: ${opp.technicals.reasons.slice(0, 3).join('; ')}` + 
          (opp.aiSentiment ? ` | AI: ${opp.aiSentiment.sentiment} - ${opp.aiSentiment.key_factors?.slice(0, 2).join(', ') || 'N/A'}` : '') 
          : opp.reason,
        indicators: opp.technicals ? [
          `RSI: ${opp.technicals.rsi?.toFixed(1)}`, 
          `Trend: ${opp.technicals.trend}`, 
          `MACD: ${opp.technicals.macd}`,
          opp.aiSentiment ? `AI: ${opp.aiSentiment.sentiment}` : null
        ].filter(Boolean) : []
      },
      created_by: user_email
    };
    
    await base44.asServiceRole.entities.Trade.create(tradeData);
    
    // Update portfolio
    let positions = [...(portfolio.positions || [])];
    const assetSymbol = `${opp.symbol}/USDT`;
    
    if (opp.action === 'sell') {
      positions = positions.filter(p => p.asset_symbol !== assetSymbol);
    } else {
      positions.push({
        asset_symbol: assetSymbol,
        quantity: opp.quantity,
        avg_entry_price: opp.price,
        current_value: opp.value,
        profit_loss: 0,
        highest_price: opp.price
      });
    }
    
    const newBalance = opp.action === 'buy'
      ? portfolio.available_balance - (opp.quantity * opp.price)
      : portfolio.available_balance + (opp.quantity * opp.price);
    
    await base44.asServiceRole.entities.Portfolio.update(portfolio.id, {
      available_balance: newBalance,
      total_balance: portfolio.total_balance + (tradeData.profit_loss || 0),
      positions,
      total_trades: (portfolio.total_trades || 0) + 1,
      total_profit_loss: (portfolio.total_profit_loss || 0) + (tradeData.profit_loss || 0)
    });
    
    // Update settings
    const newAssetsTraded = [...(settings.assets_traded_today || [])];
    if (opp.action === 'buy' && !newAssetsTraded.includes(opp.symbol)) {
      newAssetsTraded.push(opp.symbol);
    }
    
    await base44.asServiceRole.entities.AutoTradingSettings.update(settings.id, {
      trades_today: (settings.trades_today || 0) + 1,
      last_trade_date: new Date().toISOString(),
      assets_traded_today: newAssetsTraded,
      daily_loss: (settings.daily_loss || 0) + (tradeData.profit_loss < 0 ? Math.abs(tradeData.profit_loss) : 0)
    });
    
    console.log(`\n✅ TRADE EXECUTED SUCCESSFULLY`);
    console.log(`${'='.repeat(60)}\n`);
    
    return Response.json({
      success: true,
      executed: true,
      trade: {
        symbol: opp.symbol,
        action: opp.action,
        quantity: opp.quantity,
        price: opp.price,
        reason: opp.reason,
        technicalScore: opp.technicalScore || opp.score,
        combinedScore: opp.score,
        aiSentiment: opp.aiSentiment?.sentiment || 'N/A'
      }
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});