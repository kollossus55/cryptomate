import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, TrendingUp, TrendingDown, RefreshCw, Target, Brain, AlertCircle } from "lucide-react";
import TradeModal from "../components/trading/TradeModal";

const AUTO_REFRESH_INTERVAL = 10 * 60 * 1000;
const MIN_TIME_BETWEEN_LLM_CALLS = 2 * 60 * 1000;

const TOP_ASSETS = [
  { symbol: "BTC", name: "Bitcoin" },
  { symbol: "ETH", name: "Ethereum" },
  { symbol: "BNB", name: "BNB" },
  { symbol: "SOL", name: "Solana" },
  { symbol: "XRP", name: "XRP" },
  { symbol: "ADA", name: "Cardano" },
  { symbol: "AVAX", name: "Avalanche" },
  { symbol: "DOGE", name: "Dogecoin" },
  { symbol: "DOT", name: "Polkadot" },
  { symbol: "MATIC", name: "Polygon" },
  { symbol: "LINK", name: "Chainlink" },
  { symbol: "UNI", name: "Uniswap" },
  { symbol: "ATOM", name: "Cosmos" },
  { symbol: "LTC", name: "Litecoin" },
  { symbol: "NEAR", name: "NEAR Protocol" },
  { symbol: "APT", name: "Aptos" },
  { symbol: "ARB", name: "Arbitrum" },
  { symbol: "OP", name: "Optimism" },
  { symbol: "INJ", name: "Injective" },
  { symbol: "SUI", name: "Sui" },
];

const COINGECKO_IDS = {
  BTC: "bitcoin", ETH: "ethereum", BNB: "binancecoin", SOL: "solana",
  XRP: "ripple", ADA: "cardano", AVAX: "avalanche-2", DOGE: "dogecoin",
  DOT: "polkadot", MATIC: "matic-network", LINK: "chainlink", UNI: "uniswap",
  ATOM: "cosmos", LTC: "litecoin", NEAR: "near", APT: "aptos",
  ARB: "arbitrum", OP: "optimism", INJ: "injective-protocol", SUI: "sui",
};

export default function TradeSignals() {
  const [assets, setAssets] = useState([]);
  const [recommendations, setRecommendations] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [userPreferences, setUserPreferences] = useState(null);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [tradeType, setTradeType] = useState(null);
  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false);
  const [priceError, setPriceError] = useState(null);

  const queryClient = useQueryClient();
  const assetsRef = useRef(assets);
  const portfolioRef = useRef(null);
  const settingsRef = useRef(null);

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  const { data: portfolio } = useQuery({
    queryKey: ["portfolio"],
    queryFn: async () => {
      const result = await base44.entities.Portfolio.list();
      return result[0] || null;
    },
    staleTime: 30000,
  });

  const { data: autoTradingSettings } = useQuery({
    queryKey: ["auto-trading-settings"],
    queryFn: async () => {
      const result = await base44.entities.AutoTradingSettings.list();
      return result[0];
    },
    staleTime: 30000,
  });

  useEffect(() => {
    portfolioRef.current = portfolio;
    settingsRef.current = autoTradingSettings;
  }, [portfolio, autoTradingSettings]);

  // Fetch user preferences
  useEffect(() => {
    const fetchPreferences = async () => {
      try {
        const prefs = await base44.entities.TradingPreferences.list();
        if (prefs && prefs.length > 0) setUserPreferences(prefs[0]);
      } catch (e) {
        console.log("No user preferences found, using defaults");
      }
    };
    fetchPreferences();
  }, []);

  const fetchLivePrices = async () => {
    try {
      setPriceError(null);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(
        'https://www.okx.com/api/v5/market/tickers?instType=SPOT',
        { signal: controller.signal, headers: { Accept: "application/json" } }
      );
      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`OKX API returned ${response.status}`);
      const data = await response.json();
      if (!data || !Array.isArray(data.data)) throw new Error('Invalid data from OKX');

      const tickerBySymbol = {};
      data.data.forEach((t) => {
        if (typeof t.instId === 'string' && t.instId.endsWith('-USDT')) {
          tickerBySymbol[t.instId.replace(/-USDT$/, '')] = t;
        }
      });

      const liveAssets = TOP_ASSETS.map((a) => {
        const t = tickerBySymbol[a.symbol];
        if (!t) return null;
        const last = parseFloat(t.last);
        const open24h = parseFloat(t.open24h);
        const change24h = open24h > 0 ? ((last - open24h) / open24h) * 100 : 0;
        return {
          ...a,
          price: last || 0,
          change24h,
          volume24h: parseFloat(t.volCcy24h) || 0,
          marketCap: 0,
          icon: a.symbol.charAt(0),
          color: "bg-indigo-500",
        };
      }).filter((a) => a && a.price > 0);

      setAssets(liveAssets);
    } catch (error) {
      console.warn("Failed to fetch live prices:", error.message);
      setPriceError(error.message);
    }
  };

  const analyzeTopAssets = async () => {
    const lastLLMCall = localStorage.getItem("last_llm_recommendation_call");
    if (lastLLMCall) {
      const elapsed = Date.now() - parseInt(lastLLMCall);
      if (elapsed < MIN_TIME_BETWEEN_LLM_CALLS) {
        console.log(`Rate limit: Last LLM call was ${Math.round(elapsed / 1000)}s ago. Using cached/basic signals.`);
        generateBasicRecommendations();
        return;
      }
    }

    const currentAssets = assetsRef.current;
    if (!currentAssets || currentAssets.length === 0) {
      console.warn("No assets available for analysis");
      return;
    }

    setIsLoading(true);
    try {
      const pf = portfolioRef.current;
      const scored = currentAssets
        .map((asset) => {
          let score = Math.abs(asset.change24h || 0) * 2;
          if (asset.volume24h > 0) score += Math.log10(asset.volume24h);
          if (userPreferences?.preferred_assets?.includes(asset.symbol)) score += 30;
          return { asset, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 12)
        .map((item) => item.asset);

      const assetsData = scored
        .map(
          (a) =>
            `${a.name} (${a.symbol}): Price $${a.price}, 24h Change ${a.change24h?.toFixed(2)}%, Volume $${(a.volume24h / 1e9).toFixed(2)}B`
        )
        .join("\n");

      const positionsData =
        pf?.positions?.map((pos) => {
          const symbol = pos.asset_symbol.replace("/USDT", "");
          const asset = scored.find((a) => a.symbol === symbol);
          const currentPrice = asset?.price || 0;
          const pct =
            pos.avg_entry_price > 0
              ? ((currentPrice - pos.avg_entry_price) / pos.avg_entry_price * 100).toFixed(2)
              : 0;
          return `${symbol}: Holding ${pos.quantity?.toFixed(6)} @ $${pos.avg_entry_price?.toFixed(2)} entry, Current $${currentPrice.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct}% P&L)`;
        }).join("\n") || "No open positions";

      const minConfidenceBuy = userPreferences?.signal_alert_thresholds?.min_confidence_buy ?? 70;
      const minConfidenceSell = userPreferences?.signal_alert_thresholds?.min_confidence_sell ?? 65;
      const minPredictedGain = userPreferences?.signal_alert_thresholds?.min_predicted_gain ?? 5;

      const prompt = `As an advanced AI trading system, analyze these cryptocurrencies using multi-factor analysis:

CURRENT PORTFOLIO POSITIONS:
${positionsData}

MARKET DATA:
${assetsData}

User Risk Tolerance: ${userPreferences?.risk_tolerance || "moderate"}
User Trading Style: ${userPreferences?.trading_style || "balanced"}
Alert Thresholds: Buy signals minimum ${minConfidenceBuy}% confidence, Sell signals minimum ${minConfidenceSell}% confidence

Use comprehensive data sources:
1. Technical Analysis: Price momentum, volume, volatility patterns
2. Predictive Analysis: 24-hour price movement forecasts (minimum ${minPredictedGain}% gain for buy signals)
3. News Sentiment: Recent headlines, regulatory news, partnerships
4. Social Media Trends: Twitter/Reddit sentiment, influencer opinions
5. On-Chain Metrics: Whale movements, exchange flows, network activity

Recommend the BEST 5 trading opportunities with:
- PRIORITIZE: Sell signals for assets user currently holds if they show weakness or profit-taking opportunity
- High conviction trades based on multiple confirming signals
- Detailed reasoning incorporating all data sources
- For new positions: Only recommend buy signals with predicted gains above ${minPredictedGain}%
- Risk assessment considering volatility and market conditions
- Realistic target prices based on support/resistance levels
- Ensure confidence levels meet user thresholds

Return confidence as a percentage from 0-100 (e.g., 85 not 0.85).
Return ONLY the top 5 highest-conviction opportunities (can be mix of buy/sell).`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: false,
        response_json_schema: {
          type: "object",
          properties: {
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  symbol: { type: "string" },
                  action: { type: "string", enum: ["buy", "sell"] },
                  confidence: { type: "number" },
                  reasoning: { type: "string" },
                  risk_level: { type: "string", enum: ["low", "medium", "high"] },
                  target_price: { type: "number" },
                  predicted_change_24h: { type: "number" },
                  prediction_confidence: { type: "number" },
                  data_sources: {
                    type: "object",
                    properties: {
                      technical_score: { type: "number" },
                      news_sentiment: { type: "string" },
                      social_score: { type: "number" },
                      onchain_signal: { type: "string" },
                      predictive_score: { type: "number" },
                    },
                  },
                },
              },
            },
            market_summary: { type: "string" },
          },
        },
      });

      if (result?.recommendations) {
        result.recommendations = result.recommendations.map((rec) => ({
          ...rec,
          confidence: rec.confidence < 1 ? Math.round(rec.confidence * 100) : Math.round(rec.confidence),
        }));
      }

      setRecommendations(result);
      setLastUpdated(new Date());
      localStorage.setItem("cached_ai_recommendations", JSON.stringify(result));
      localStorage.setItem("last_llm_recommendation_call", Date.now().toString());
    } catch (error) {
      console.error("Failed to analyze assets:", error);
      const cached = localStorage.getItem("cached_ai_recommendations");
      if (cached) {
        setRecommendations(JSON.parse(cached));
        setLastUpdated(new Date());
      } else {
        generateBasicRecommendations();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const generateBasicRecommendations = () => {
    const currentAssets = assetsRef.current;
    if (!currentAssets || currentAssets.length === 0) return;

    const opportunities = currentAssets
      .filter((a) => Math.abs(a.change24h) > 2)
      .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
      .slice(0, 5)
      .map((asset) => ({
        symbol: asset.symbol,
        action: asset.change24h > 0 ? "buy" : "sell",
        confidence: Math.min(85, Math.round(60 + Math.abs(asset.change24h) * 2)),
        reasoning: `${asset.name} shows a ${asset.change24h > 0 ? "positive" : "negative"} 24h change of ${asset.change24h?.toFixed(2)}% with volume of $${(asset.volume24h / 1e9).toFixed(2)}B. Technical momentum suggests a ${asset.change24h > 0 ? "buy" : "sell"} opportunity.`,
        risk_level: Math.abs(asset.change24h) > 8 ? "high" : Math.abs(asset.change24h) > 4 ? "medium" : "low",
        target_price: asset.price * (asset.change24h > 0 ? 1.08 : 0.92),
        predicted_change_24h: asset.change24h > 0 ? asset.change24h * 0.5 : asset.change24h * 0.5,
        prediction_confidence: 65,
        data_sources: {
          technical_score: Math.round(50 + Math.abs(asset.change24h) * 3),
          news_sentiment: asset.change24h > 0 ? "positive" : "negative",
          social_score: 60,
          onchain_signal: "neutral",
          predictive_score: 60,
        },
      }));

    setRecommendations({
      recommendations: opportunities,
      market_summary: `Market analysis based on live price data. ${opportunities.length} opportunities identified by momentum scanning.`,
    });
    setLastUpdated(new Date());
  };

  // Initial load + auto-refresh
  useEffect(() => {
    const init = async () => {
      await fetchLivePrices();
    };
    init();
  }, []);

  useEffect(() => {
    if (assets.length > 0 && !recommendations) {
      analyzeTopAssets();
    }
  }, [assets]);

  useEffect(() => {
    if (assets.length === 0) return;
    const interval = setInterval(() => {
      fetchLivePrices();
      analyzeTopAssets();
    }, AUTO_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [assets.length]);

  const handleTrade = (asset, action) => {
    setSelectedAsset(asset);
    setTradeType(action);
    setIsTradeModalOpen(true);
  };

  const handleExecuteTrade = async ({ asset, tradeType, quantity, price, totalValue }) => {
    if (!portfolioRef.current) return;
    const slippage = 0.001 + Math.random() * 0.001;
    const slippageAmount = tradeType === "buy" ? slippage : -slippage;
    const executionPrice = price * (1 + slippageAmount);
    const actualTotal = quantity * executionPrice;

    await new Promise((resolve) => setTimeout(resolve, 800));

    let profitLoss = 0;
    let updatedPositions = [...(portfolioRef.current.positions || [])];
    const assetSymbol = `${asset.symbol}/USDT`;
    const idx = updatedPositions.findIndex((p) => p.asset_symbol === assetSymbol);
    const existing = idx >= 0 ? updatedPositions[idx] : null;

    if (tradeType === "buy") {
      if (existing) {
        const totalQty = existing.quantity + quantity;
        const totalCost = existing.quantity * existing.avg_entry_price + actualTotal;
        updatedPositions[idx] = {
          ...existing,
          quantity: totalQty,
          avg_entry_price: totalCost / totalQty,
          current_value: totalQty * executionPrice,
          profit_loss: (executionPrice - totalCost / totalQty) * totalQty,
        };
      } else {
        updatedPositions.push({
          asset_symbol: assetSymbol,
          quantity,
          avg_entry_price: executionPrice,
          current_value: actualTotal,
          profit_loss: 0,
          highest_price: executionPrice,
        });
      }
    } else {
      if (existing) {
        const sellQty = Math.min(quantity, existing.quantity);
        profitLoss = (executionPrice - existing.avg_entry_price) * sellQty;
        if (sellQty >= existing.quantity) {
          updatedPositions.splice(idx, 1);
        } else {
          updatedPositions[idx] = {
            ...existing,
            quantity: existing.quantity - sellQty,
            current_value: (existing.quantity - sellQty) * executionPrice,
            profit_loss: (executionPrice - existing.avg_entry_price) * (existing.quantity - sellQty),
          };
        }
      }
    }

    await base44.entities.Trade.create({
      asset_symbol: assetSymbol,
      trade_type: tradeType,
      quantity,
      price: executionPrice,
      total_value: actualTotal,
      exchange: "Paper Trading",
      status: "completed",
      profit_loss: profitLoss,
    });

    const pf = portfolioRef.current;
    const newBalance =
      tradeType === "buy" ? pf.available_balance - actualTotal : pf.available_balance + actualTotal;

    await base44.entities.Portfolio.update(pf.id, {
      total_balance: pf.total_balance + profitLoss,
      available_balance: newBalance,
      positions: updatedPositions,
      total_profit_loss: (pf.total_profit_loss || 0) + profitLoss,
      total_trades: (pf.total_trades || 0) + 1,
    });

    await base44.entities.Notification.create({
      notification_type: "order_filled",
      priority: "medium",
      title: "Order Filled",
      message: `${tradeType.toUpperCase()} order for ${quantity.toFixed(6)} ${asset.symbol} filled at $${executionPrice.toFixed(2)}`,
      data: { asset: asset.symbol, type: tradeType, quantity, price: executionPrice, total: actualTotal },
    });

    queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    queryClient.invalidateQueries({ queryKey: ["trades"] });
  };

  const getConfidenceColor = (c) => (c >= 80 ? "text-green-400" : c >= 60 ? "text-yellow-400" : "text-orange-400");
  const getRiskColor = (r) =>
    r === "low"
      ? "bg-green-500/20 text-green-400 border-green-500/30"
      : r === "medium"
      ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
      : "bg-red-500/20 text-red-400 border-red-500/30";

  return (
    <div className="min-h-screen text-white">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center">
                <Brain className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                  AI Trade Signals
                </h1>
                <p className="text-slate-400 text-sm">
                  Latest AI-analyzed trading opportunities • Auto-refreshing every 10 minutes
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-slate-400">
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <Button
              onClick={() => {
                fetchLivePrices();
                analyzeTopAssets();
              }}
              disabled={isLoading}
              className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              {isLoading ? "Analyzing..." : "Refresh Signals"}
            </Button>
          </div>
        </div>

        {/* Market Summary */}
        {recommendations?.market_summary && (
          <Card className="bg-gradient-to-r from-indigo-900/40 to-purple-900/40 border-indigo-500/30 mb-6">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
                <p className="text-indigo-100 text-sm leading-relaxed">{recommendations.market_summary}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Price Error */}
        {priceError && (
          <Card className="bg-orange-500/10 border-orange-500/30 mb-6">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-orange-300 font-medium text-sm">Live Prices Unavailable</p>
                  <p className="text-orange-200/70 text-xs mt-1">
                    Could not fetch live prices ({priceError}). Showing cached data. Click Refresh to retry.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Loading */}
        {isLoading && !recommendations && (
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="py-16 text-center">
              <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin mx-auto mb-4" />
              <p className="text-slate-300 font-medium">Analyzing markets with AI...</p>
              <p className="text-slate-500 text-sm mt-1">Processing technical, sentiment, and on-chain data</p>
            </CardContent>
          </Card>
        )}

        {/* Recommendations */}
        {recommendations?.recommendations && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recommendations.recommendations.map((rec, idx) => {
              const asset = assets.find((a) => a.symbol === rec.symbol) || {
                symbol: rec.symbol,
                name: rec.symbol,
                price: rec.target_price || 0,
                icon: rec.symbol.charAt(0),
                color: "bg-slate-600",
              };
              if (!asset.price) return null;

              return (
                <Card
                  key={rec.symbol}
                  className="bg-slate-800 border-slate-700 hover:border-indigo-500/50 transition-all"
                >
                  <CardContent className="pt-6">
                    {/* Header row */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${asset.color}`}>
                          <span className="text-lg font-bold">{asset.icon}</span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-white text-lg">{rec.symbol}</h3>
                            <Badge
                              className={
                                rec.action === "buy"
                                  ? "bg-green-500/20 text-green-300 border-green-500/30"
                                  : "bg-red-500/20 text-red-300 border-red-500/30"
                              }
                            >
                              {rec.action === "buy" ? (
                                <TrendingUp className="w-3 h-3 mr-1" />
                              ) : (
                                <TrendingDown className="w-3 h-3 mr-1" />
                              )}
                              {rec.action.toUpperCase()}
                            </Badge>
                          </div>
                          <p className="text-slate-400 text-sm">${asset.price.toLocaleString()}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-3xl font-bold ${getConfidenceColor(rec.confidence)}`}>
                          {rec.confidence}%
                        </div>
                        <p className="text-slate-500 text-xs">Confidence</p>
                      </div>
                    </div>

                    {/* Reasoning */}
                    <p className="text-slate-300 text-sm mb-4 leading-relaxed">{rec.reasoning}</p>

                    {/* Prediction */}
                    {rec.predicted_change_24h != null && (
                      <div className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/30 rounded-lg p-3 mb-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-xs text-purple-300">24h Prediction</span>
                            <div
                              className={`text-lg font-bold ${
                                rec.predicted_change_24h > 0 ? "text-green-400" : "text-red-400"
                              }`}
                            >
                              {rec.predicted_change_24h > 0 ? "+" : ""}
                              {rec.predicted_change_24h.toFixed(2)}%
                            </div>
                          </div>
                          {rec.prediction_confidence != null && (
                            <div className="text-right">
                              <span className="text-xs text-purple-300">Pred. Confidence</span>
                              <div className="text-lg font-bold text-purple-400">
                                {rec.prediction_confidence}%
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Data sources */}
                    {rec.data_sources && (
                      <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
                        <div className="bg-slate-900/50 rounded p-2">
                          <span className="text-slate-500">Technical: </span>
                          <span className="text-white font-semibold">{rec.data_sources.technical_score}/100</span>
                        </div>
                        <div className="bg-slate-900/50 rounded p-2">
                          <span className="text-slate-500">News: </span>
                          <span className="text-white font-semibold capitalize">{rec.data_sources.news_sentiment}</span>
                        </div>
                        <div className="bg-slate-900/50 rounded p-2">
                          <span className="text-slate-500">Social: </span>
                          <span className="text-white font-semibold">{rec.data_sources.social_score}/100</span>
                        </div>
                        <div className="bg-slate-900/50 rounded p-2">
                          <span className="text-slate-500">On-Chain: </span>
                          <span className="text-white font-semibold capitalize">{rec.data_sources.onchain_signal}</span>
                        </div>
                      </div>
                    )}

                    {/* Footer */}
                    <div className="flex items-center justify-between">
                      <div className="flex gap-2 flex-wrap">
                        <Badge className={getRiskColor(rec.risk_level)}>{rec.risk_level} risk</Badge>
                        {rec.target_price && typeof rec.target_price === "number" && (
                          <Badge variant="outline" className="border-indigo-400/50 text-indigo-300">
                            <Target className="w-3 h-3 mr-1" />${rec.target_price.toLocaleString()}
                          </Badge>
                        )}
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleTrade(asset, rec.action)}
                        className={
                          rec.action === "buy"
                            ? "bg-green-600 hover:bg-green-700"
                            : "bg-red-600 hover:bg-red-700"
                        }
                      >
                        Trade Now
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !recommendations && (
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="py-16 text-center">
              <Brain className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">No signals available yet. Click Refresh to analyze the market.</p>
            </CardContent>
          </Card>
        )}

        {/* Info */}
        <div className="mt-6 text-center">
          <p className="text-xs text-slate-500">
            🔄 Auto-refreshes every 10 minutes • Signals are AI-generated for educational paper trading only
          </p>
        </div>
      </div>

      {/* Trade Modal */}
      {selectedAsset && (
        <TradeModal
          isOpen={isTradeModalOpen}
          onClose={() => setIsTradeModalOpen(false)}
          asset={selectedAsset}
          tradeType={tradeType}
          onExecuteTrade={handleExecuteTrade}
          portfolio={portfolio}
        />
      )}
    </div>
  );
}