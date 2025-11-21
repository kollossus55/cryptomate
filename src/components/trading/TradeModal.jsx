import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, TrendingUp, Sparkles, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function TradeModal({ isOpen, onClose, asset, tradeType, onExecuteTrade, portfolio }) {
  const [quantity, setQuantity] = useState("");
  const [percentage, setPercentage] = useState([25]);
  const [isExecuting, setIsExecuting] = useState(false);

  const availableBalance = portfolio?.available_balance || 10000;
  const assetPrice = asset?.price || 0;
  const totalValue = quantity && assetPrice ? (parseFloat(quantity) * assetPrice).toFixed(2) : "0.00";

  // Calculate smart position sizing recommendations
  const calculateRecommendations = () => {
    if (!assetPrice || assetPrice === 0) {
      return {
        conservative: "0",
        moderate: "0",
        aggressive: "0"
      };
    }
    
    const conservative = (availableBalance * 0.05) / assetPrice; // 5% of portfolio
    const moderate = (availableBalance * 0.10) / assetPrice; // 10% of portfolio
    const aggressive = (availableBalance * 0.20) / assetPrice; // 20% of portfolio

    return {
      conservative: conservative.toFixed(6),
      moderate: moderate.toFixed(6),
      aggressive: aggressive.toFixed(6)
    };
  };

  const recommendations = calculateRecommendations();

  useEffect(() => {
    // Set default to moderate recommendation for buy, or clear for sell initially
    if (tradeType === 'buy' && recommendations.moderate !== "0") {
      setQuantity(recommendations.moderate);
    } else if (tradeType === 'sell') {
      setQuantity(""); // Clear quantity when switching to sell
    }
  }, [asset, recommendations.moderate, tradeType]); // Added tradeType as dependency

  const handlePercentageChange = (value) => {
    setPercentage(value);
    if (assetPrice && assetPrice > 0) { // Prevent division by zero
      const amount = (availableBalance * value[0] / 100) / assetPrice;
      setQuantity(amount.toFixed(6));
    }
  };

  const handleQuickAmount = (amount) => {
    setQuantity(amount);
    // This logic is primarily for buy-side percentage calculation
    if (tradeType === 'buy' && availableBalance > 0 && assetPrice > 0) { 
      const percent = (parseFloat(amount) * assetPrice / availableBalance) * 100;
      setPercentage([Math.min(percent, 100)]);
    } else if (tradeType === 'sell' && position?.quantity > 0) { // For sell side, calculate percentage of owned
      const percent = (parseFloat(amount) / position.quantity) * 100;
      setPercentage([Math.min(percent, 100)]);
    } else {
      setPercentage([0]);
    }
  };

  const handleExecute = async () => {
    if (!quantity || parseFloat(quantity) <= 0) return;
    
    const calculatedTotal = parseFloat(totalValue);
    if (tradeType === 'buy' && calculatedTotal > availableBalance) {
      alert("Insufficient balance!");
      return;
    }
    
    // Check if selling more than owned
    if (tradeType === 'sell' && portfolio?.positions) {
      const assetSymbol = `${asset.symbol}/USDT`;
      const position = portfolio.positions.find(p => p.asset_symbol === assetSymbol);
      const ownedQuantity = position?.quantity || 0;
      
      if (parseFloat(quantity) > ownedQuantity) {
        alert(`Insufficient holdings! You own ${ownedQuantity.toFixed(6)} ${asset.symbol}. Cannot sell ${parseFloat(quantity).toFixed(6)}.`);
        return;
      }
    }
    
    setIsExecuting(true);
    try {
      await onExecuteTrade({
        asset,
        tradeType,
        quantity: parseFloat(quantity),
        price: assetPrice,
        totalValue: calculatedTotal
      });
      onClose();
    } catch (error) {
      console.error("Trade execution failed:", error);
      alert("Trade execution failed. Please try again.");
    } finally {
      setIsExecuting(false);
    }
  };

  const getPositionSizeColor = (value) => {
    if (!value || !assetPrice || !availableBalance || availableBalance === 0 || assetPrice === 0) return "text-white"; // Avoid division by zero
    const percent = (parseFloat(value) * assetPrice / availableBalance) * 100;
    if (percent <= 5) return "text-green-400";
    if (percent <= 15) return "text-yellow-400";
    return "text-red-400";
  };

  // Add position info for selling
  const getPositionInfo = () => {
    if (tradeType === 'sell' && portfolio?.positions) {
      const assetSymbol = `${asset.symbol}/USDT`; // Assuming asset.symbol is like BTC and position.asset_symbol is like BTC/USDT
      const position = portfolio.positions.find(p => p.asset_symbol === assetSymbol);
      return position;
    }
    return null;
  };

  const position = getPositionInfo();

  if (!asset) return null;

  const change24h = asset.change24h || 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl max-h-[90vh]">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="text-xl flex items-center gap-2">
            {tradeType === 'buy' ? 'Buy' : 'Sell'} {asset.symbol}
            <Badge className={tradeType === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}>
              {tradeType.toUpperCase()}
            </Badge>
            <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 ml-auto">
              PAPER TRADING
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto flex-1" style={{ maxHeight: "calc(90vh - 120px)" }}>
          <div className="space-y-6 py-4 px-1">
          {/* Asset Info */}
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-slate-400 text-sm">Current Price (Live)</span>
                <div className="text-white font-semibold text-lg">
                  ${assetPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                </div>
              </div>
              <div>
                <span className="text-slate-400 text-sm">24h Change</span>
                <div className={change24h >= 0 ? 'text-green-400 font-semibold text-lg' : 'text-red-400 font-semibold text-lg'}>
                  {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
                </div>
              </div>
              <div>
                <span className="text-slate-400 text-sm">Available Balance</span>
                <div className="text-white font-semibold text-lg">${availableBalance.toLocaleString()}</div>
              </div>
              <div>
                <span className="text-slate-400 text-sm">{tradeType === 'buy' ? 'Total Cost' : 'Total Value'}</span>
                <div className={`font-semibold text-lg ${parseFloat(totalValue) > availableBalance && tradeType === 'buy' ? 'text-red-400' : 'text-white'}`}>
                  ${totalValue} USDT
                </div>
              </div>
            </div>
          </div>

          {/* Position Info for Selling */}
          {tradeType === 'sell' && position && (
            <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-5 h-5 text-indigo-400" />
                <h3 className="font-semibold text-white">Your Position</h3>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-slate-400 text-xs mb-1">Holdings</p>
                  <p className="text-white font-bold">{position.quantity?.toFixed(6)}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs mb-1">Avg Entry</p>
                  <p className="text-white font-bold">${position.avg_entry_price?.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs mb-1">Unrealized P&L</p>
                  <p className={`font-bold ${(position.profit_loss || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {(position.profit_loss || 0) >= 0 ? '+' : ''}${(position.profit_loss || 0).toFixed(2)}
                  </p>
                </div>
              </div>
              {quantity && parseFloat(quantity) > 0 && position.avg_entry_price && (
                <div className="mt-3 pt-3 border-t border-indigo-500/30">
                  <p className="text-xs text-slate-400 mb-1">Estimated Realized P&L:</p>
                  <p className={`text-lg font-bold ${
                    ((assetPrice - position.avg_entry_price) * parseFloat(quantity)) >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {((assetPrice - position.avg_entry_price) * parseFloat(quantity)) >= 0 ? '+' : ''}
                    ${((assetPrice - position.avg_entry_price) * parseFloat(quantity)).toFixed(2)}
                  </p>
                </div>
              )}
            </div>
          )}

          {tradeType === 'sell' && !position && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex gap-2">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-red-200 font-semibold">No Position Found</p>
                <p className="text-xs text-red-200/80">
                  You don't own any {asset.symbol}. Buy some first before selling.
                </p>
              </div>
            </div>
          )}

          {/* AI Recommendations */}
          {tradeType === 'buy' && (
            <div className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-5 h-5 text-indigo-400" />
                <h3 className="font-semibold text-white">AI Position Sizing</h3>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={() => handleQuickAmount(recommendations.conservative)}
                  className="bg-slate-800 hover:bg-slate-700 border border-green-500/50 rounded-lg p-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={recommendations.conservative === "0"}
                >
                  <div className="text-green-400 text-sm mb-1">Conservative</div>
                  <div className="text-white font-bold">{recommendations.conservative}</div>
                  <div className="text-slate-400 text-xs">5% Portfolio</div>
                </button>
                <button
                  onClick={() => handleQuickAmount(recommendations.moderate)}
                  className="bg-slate-800 hover:bg-slate-700 border border-indigo-500 rounded-lg p-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={recommendations.moderate === "0"}
                >
                  <div className="text-yellow-400 text-sm mb-1">Moderate</div>
                  <div className="text-white font-bold">{recommendations.moderate}</div>
                  <div className="text-slate-400 text-xs">10% Portfolio</div>
                </button>
                <button
                  onClick={() => handleQuickAmount(recommendations.aggressive)}
                  className="bg-slate-800 hover:bg-slate-700 border border-red-500/50 rounded-lg p-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={recommendations.aggressive === "0"}
                >
                  <div className="text-red-400 text-sm mb-1">Aggressive</div>
                  <div className="text-white font-bold">{recommendations.aggressive}</div>
                  <div className="text-slate-400 text-xs">20% Portfolio</div>
                </button>
              </div>
            </div>
          )}

          {/* Quantity Input */}
          <div>
            <Label className="text-slate-300 mb-2 block flex items-center gap-2">
              Quantity
              {tradeType === 'buy' && quantity && assetPrice > 0 && availableBalance > 0 && ( // Ensure no division by zero for buy
                <span className={`text-xs ${getPositionSizeColor(quantity)}`}>
                  ({((parseFloat(quantity) * assetPrice / availableBalance) * 100).toFixed(1)}% of portfolio)
                </span>
              )}
              {tradeType === 'sell' && quantity && position?.quantity > 0 && ( // For sell, percentage of owned holdings
                 <span className={`text-xs ${parseFloat(quantity) > position.quantity ? 'text-red-400' : 'text-indigo-400'}`}>
                   ({((parseFloat(quantity) / position.quantity) * 100).toFixed(1)}% of holdings)
                 </span>
              )}
            </Label>
            <Input
              type="number"
              placeholder="0.000000"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white text-lg"
              step="0.000001"
            />
          </div>

          {/* Quick Amount Buttons */}
          {tradeType === 'buy' && (
            <div className="grid grid-cols-4 gap-2">
              <Button
                onClick={() => assetPrice > 0 && handleQuickAmount((100 / assetPrice).toFixed(6))}
                className="bg-slate-800 border border-slate-600 text-white hover:bg-slate-700"
                disabled={!assetPrice || assetPrice === 0}
              >
                $100
              </Button>
              <Button
                onClick={() => assetPrice > 0 && handleQuickAmount((500 / assetPrice).toFixed(6))}
                className="bg-slate-800 border border-slate-600 text-white hover:bg-slate-700"
                disabled={!assetPrice || assetPrice === 0}
              >
                $500
              </Button>
              <Button
                onClick={() => assetPrice > 0 && handleQuickAmount((1000 / assetPrice).toFixed(6))}
                className="bg-slate-800 border border-slate-600 text-white hover:bg-slate-700"
                disabled={!assetPrice || assetPrice === 0}
              >
                $1000
              </Button>
              <Button
                onClick={() => assetPrice > 0 && handleQuickAmount((availableBalance / assetPrice).toFixed(6))}
                className="bg-slate-800 border border-slate-600 text-white hover:bg-slate-700"
                disabled={!assetPrice || assetPrice === 0}
              >
                Max
              </Button>
            </div>
          )}

          {tradeType === 'sell' && position && (
            <div className="grid grid-cols-4 gap-2">
              <Button
                onClick={() => handleQuickAmount((position.quantity * 0.25).toFixed(6))}
                className="bg-slate-800 border border-slate-600 text-white hover:bg-slate-700"
              >
                25%
              </Button>
              <Button
                onClick={() => handleQuickAmount((position.quantity * 0.5).toFixed(6))}
                className="bg-slate-800 border border-slate-600 text-white hover:bg-slate-700"
              >
                50%
              </Button>
              <Button
                onClick={() => handleQuickAmount((position.quantity * 0.75).toFixed(6))}
                className="bg-slate-800 border border-slate-600 text-white hover:bg-slate-700"
              >
                75%
              </Button>
              <Button
                onClick={() => handleQuickAmount(position.quantity.toFixed(6))}
                className="bg-slate-800 border border-slate-600 text-white hover:bg-slate-700"
              >
                Max
              </Button>
            </div>
          )}

          {/* Percentage Slider - only for buying */}
          {tradeType === 'buy' && (
            <div>
              <Label className="text-slate-300 mb-3 block">Portfolio Allocation</Label>
              <Slider
                value={percentage}
                onValueChange={handlePercentageChange}
                max={100}
                step={1}
                className="mb-2"
                disabled={!assetPrice || assetPrice === 0}
              />
              <div className="flex justify-between text-xs text-slate-400">
                <span>0%</span>
                <span className="text-indigo-400 font-semibold">{percentage[0]}%</span>
                <span>100%</span>
              </div>
            </div>
          )}

          {/* Warning */}
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 flex gap-2">
            <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-yellow-200 font-semibold mb-1">Paper Trading Mode</p>
              <p className="text-xs text-yellow-200/80">
                This trade will be executed with simulated funds and real market prices. 
                Includes realistic slippage (0.1-0.2%) and execution delays.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 border-slate-600 bg-slate-800 text-white hover:bg-slate-700 hover:border-slate-500"
            >
              Cancel
            </Button>
            <Button
              onClick={handleExecute}
              disabled={
                !quantity || 
                parseFloat(quantity) <= 0 || 
                (tradeType === 'buy' && parseFloat(totalValue) > availableBalance) ||
                (tradeType === 'sell' && !position) || // Disable sell button if no position
                (tradeType === 'sell' && parseFloat(quantity) > (position?.quantity || 0)) || // Disable if trying to sell more than owned
                isExecuting || 
                !assetPrice
              }
              className={`flex-1 ${
                tradeType === 'buy' 
                  ? 'bg-green-600 hover:bg-green-700 text-white' 
                  : 'bg-red-600 hover:bg-red-700 text-white'
              }`}
            >
              {isExecuting ? 'Executing Trade...' : `${tradeType === 'buy' ? 'Buy' : 'Sell'} ${asset.symbol}`}
            </Button>
          </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}