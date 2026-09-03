import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Scan, RefreshCw, TrendingUp, TrendingDown, AlertCircle } from "lucide-react";
import TradeModal from "../components/trading/TradeModal";
import { scanAltcoins, getCategories } from "../components/trading/AltcoinScanner";

const CATEGORY_COLORS = {
  DeFi: "bg-blue-500",
  "Layer 1": "bg-purple-500",
  "Layer 2": "bg-indigo-500",
  Gaming: "bg-pink-500",
  AI: "bg-cyan-500",
  Meme: "bg-orange-500",
  Infrastructure: "bg-green-500",
  Altcoin: "bg-slate-500",
};

const getRiskColor = (r) =>
  r === "low"
    ? "bg-green-500/20 text-green-400 border-green-500/30"
    : r === "medium"
    ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
    : "bg-red-500/20 text-red-400 border-red-500/30";

// Quality filters — only surface actionable, high-conviction setups.
const MIN_SCORE = 65;          // buy territory (drops Hold 45–64)
const MIN_VOLUME_SURGE = 1.5;   // real relative volume vs average
const MIN_MOMENTUM = 2;         // |24h change| % — must already be moving

const filterOpportunities = (list) =>
  list.filter(
    (o) =>
      o.signal !== "hold" &&
      o.score >= MIN_SCORE &&
      o.volume_surge >= MIN_VOLUME_SURGE &&
      Math.abs(o.momentum) >= MIN_MOMENTUM
  );

export default function AltcoinScanner() {
  const [opportunities, setOpportunities] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [lastScan, setLastScan] = useState(null);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [tradeType, setTradeType] = useState(null);
  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false);
  const [scanError, setScanError] = useState(null);

  const queryClient = useQueryClient();
  const portfolioRef = useRef(null);

  const { data: portfolio } = useQuery({
    queryKey: ["portfolio"],
    queryFn: async () => {
      const result = await base44.entities.Portfolio.list();
      return result[0] || null;
    },
    staleTime: 30000,
  });

  useEffect(() => {
    portfolioRef.current = portfolio;
  }, [portfolio]);

  const runScan = async () => {
    setIsLoading(true);
    setScanError(null);
    try {
      const raw = await scanAltcoins(50);
      const filtered = filterOpportunities(raw);
      setOpportunities(filtered);
      setLastScan(new Date());
      // Populate the global so other pages (Trading, Trade Signals) can consume
      window.altcoinOpportunities = filtered;
      if (raw.length === 0) {
        setScanError("No opportunities found. Binance may be unavailable — try refreshing.");
      } else if (filtered.length === 0) {
        setScanError(
          `Scanned ${raw.length} coins but none passed the quality filters (score ≥ ${MIN_SCORE}, volume ≥ ${MIN_VOLUME_SURGE}x, |move| ≥ ${MIN_MOMENTUM}%). The market is flat right now — try refreshing later.`
        );
      }
    } catch (error) {
      console.error("Scanner failed:", error);
      setScanError(error.message || "Scan failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    runScan();
  }, []);

  const handleTrade = (opp, action) => {
    const asset = {
      symbol: opp.symbol,
      name: opp.name,
      price: opp.simulated_price,
      icon: opp.symbol.charAt(0),
      color: CATEGORY_COLORS[opp.category] || "bg-slate-600",
    };
    setSelectedAsset(asset);
    setTradeType(action);
    setIsTradeModalOpen(true);
  };

  const handleExecuteTrade = async ({ asset, tradeType, quantity, price, totalValue }) => {
    const pf = portfolioRef.current;
    if (!pf) return;
    const slippage = 0.001 + Math.random() * 0.001;
    const slippageAmount = tradeType === "buy" ? slippage : -slippage;
    const executionPrice = price * (1 + slippageAmount);
    const actualTotal = quantity * executionPrice;

    await new Promise((resolve) => setTimeout(resolve, 800));

    let profitLoss = 0;
    let updatedPositions = [...(pf.positions || [])];
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

    const newBalance = tradeType === "buy" ? pf.available_balance - actualTotal : pf.available_balance + actualTotal;

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
      message: `${tradeType.toUpperCase()} order for ${quantity.toFixed(6)} ${asset.symbol} filled at $${executionPrice.toFixed(4)}`,
      data: { asset: asset.symbol, type: tradeType, quantity, price: executionPrice, total: actualTotal },
    });

    queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    queryClient.invalidateQueries({ queryKey: ["trades"] });
  };

  const filteredOpportunities =
    selectedCategory === "all" ? opportunities : opportunities.filter((o) => o.category === selectedCategory);

  return (
    <div className="min-h-screen text-white">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center">
                <Scan className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                  Altcoin Scanner
                </h1>
                <p className="text-slate-400 text-sm">
                  Scanning 100+ altcoins on real Binance data • No auto-refresh to conserve resources
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastScan && (
              <span className="text-xs text-slate-400">Last scan {lastScan.toLocaleTimeString()}</span>
            )}
            <Button
              onClick={runScan}
              disabled={isLoading}
              className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              {isLoading ? "Scanning..." : "Refresh Scan"}
            </Button>
          </div>
        </div>

        {/* Error */}
        {scanError && !isLoading && (
          <Card className="bg-orange-500/10 border-orange-500/30 mb-6">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
                <p className="text-orange-200 text-sm">{scanError}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Category Filter */}
        <div className="flex gap-2 flex-wrap mb-6">
          <Button
            variant={selectedCategory === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedCategory("all")}
            className={
              selectedCategory === "all"
                ? "bg-cyan-600 text-white"
                : "border-cyan-400/50 bg-slate-800 text-cyan-300 hover:bg-cyan-600 hover:text-white"
            }
          >
            All ({opportunities.length})
          </Button>
          {getCategories().map((cat) => {
            const count = opportunities.filter((o) => o.category === cat).length;
            if (count === 0) return null;
            return (
              <Button
                key={cat}
                variant={selectedCategory === cat ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedCategory(cat)}
                className={
                  selectedCategory === cat
                    ? "bg-cyan-600 text-white"
                    : "border-cyan-400/50 bg-slate-800 text-cyan-300 hover:bg-cyan-600 hover:text-white"
                }
              >
                {cat} ({count})
              </Button>
            );
          })}
        </div>

        {/* Loading */}
        {isLoading && opportunities.length === 0 && (
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="py-16 text-center">
              <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin mx-auto mb-4" />
              <p className="text-slate-300 font-medium">Scanning altcoins on Binance...</p>
              <p className="text-slate-500 text-sm mt-1">Fetching real OHLCV data and scoring indicators</p>
            </CardContent>
          </Card>
        )}

        {/* Opportunities */}
        {filteredOpportunities.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredOpportunities.map((opp, idx) => {
              const riskLevel = opp.score >= 75 ? "low" : opp.score >= 60 ? "medium" : "high";
              const action = opp.signal === "strong_buy" || opp.signal === "buy" ? "buy" : "sell";

              return (
                <Card key={opp.symbol} className="bg-slate-800 border-slate-700 hover:border-cyan-500/40 transition-all">
                  <CardContent className="pt-6">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${CATEGORY_COLORS[opp.category] || "bg-slate-600"}`}>
                          <span className="text-lg font-bold">{opp.symbol.charAt(0)}</span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-white text-lg">{opp.symbol}</h3>
                            <Badge
                              className={
                                action === "buy"
                                  ? "bg-green-500/20 text-green-300 border-green-500/30"
                                  : "bg-red-500/20 text-red-300 border-red-500/30"
                              }
                            >
                              {action === "buy" ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                              {opp.signal.replace("_", " ").toUpperCase()}
                            </Badge>
                          </div>
                          <p className="text-slate-400 text-sm">{opp.name}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-cyan-400">{opp.score}/100</div>
                        <p className="text-slate-500 text-xs">Signal Score</p>
                      </div>
                    </div>

                    {/* Metrics */}
                    <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
                      <div className="bg-slate-900/50 rounded p-2">
                        <span className="text-slate-500">Momentum: </span>
                        <span className="text-white font-semibold">{opp.momentum.toFixed(1)}%</span>
                      </div>
                      <div className="bg-slate-900/50 rounded p-2">
                        <span className="text-slate-500">Vol Surge: </span>
                        <span className="text-white font-semibold">{opp.volume_surge.toFixed(2)}x</span>
                      </div>
                      <div className="bg-slate-900/50 rounded p-2">
                        <span className="text-slate-500">Volatility: </span>
                        <span className="text-white font-semibold">{opp.volatility?.toFixed(2)}%</span>
                      </div>
                      <div className="bg-slate-900/50 rounded p-2">
                        <span className="text-slate-500">Price: </span>
                        <span className="text-white font-semibold">${opp.simulated_price.toFixed(4)}</span>
                      </div>
                    </div>

                    {/* Reasons */}
                    {opp.reasons && opp.reasons.length > 0 && (
                      <div className="mb-4 space-y-1">
                        {opp.reasons.slice(0, 3).map((reason, i) => (
                          <p key={i} className="text-xs text-slate-400 flex items-start gap-1.5">
                            <span className="text-cyan-400 mt-0.5">•</span>
                            <span>{reason}</span>
                          </p>
                        ))}
                      </div>
                    )}

                    {/* Footer */}
                    <div className="flex items-center justify-between">
                      <div className="flex gap-2 flex-wrap">
                        <Badge className={getRiskColor(riskLevel)}>{riskLevel} risk</Badge>
                        <Badge className="bg-white/10 text-white border-white/20">{opp.category}</Badge>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleTrade(opp, action)}
                        className={action === "buy" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}
                      >
                        Trade
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Empty */}
        {!isLoading && filteredOpportunities.length === 0 && opportunities.length > 0 && (
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="py-16 text-center">
              <p className="text-slate-400">No opportunities in the "{selectedCategory}" category.</p>
            </CardContent>
          </Card>
        )}
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