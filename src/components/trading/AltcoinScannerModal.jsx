import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Scan, X, RefreshCw, Target, TrendingUp, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { scanAltcoins, getCategories } from "./AltcoinScanner";

export default function AltcoinScannerModal({ onClose, onTradeAsset }) {
  const [isVisible, setIsVisible] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [opportunities, setOpportunities] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("all");

  useEffect(() => {
    runScan();
  }, []);

  const runScan = async () => {
    setIsLoading(true);
    try {
      console.log('🔍 Running altcoin scanner...');
      // Score with the indicators selected on the AI Signals page, so this
      // browser scan agrees with the server-side scan and the auto-trader.
      let indicatorSettings = null;
      try {
        const configs = await base44.entities.AISignalConfig.list();
        const active = configs.find((c) => c.is_active) || configs[0] || null;
        indicatorSettings = active?.indicator_settings || null;
      } catch (err) {
        console.warn('Signal config unavailable, using engine defaults:', err.message);
      }
      const results = await scanAltcoins(12, indicatorSettings);
      setOpportunities(results);
    } catch (error) {
      console.error('Scanner failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => {
      onClose();
    }, 300);
  };

  const getCategoryColor = (category) => {
    const colors = {
      'DeFi': 'bg-blue-500',
      'Layer 1': 'bg-purple-500',
      'Layer 2': 'bg-indigo-500',
      'Gaming': 'bg-pink-500',
      'AI': 'bg-cyan-500',
      'Meme': 'bg-orange-500',
      'Infrastructure': 'bg-green-500',
      'Privacy': 'bg-slate-500',
      'NFT': 'bg-red-500'
    };
    return colors[category] || 'bg-gray-500';
  };

  const getRiskColor = (risk) => {
    switch(risk) {
      case 'low': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'high': return 'bg-red-500/20 text-red-400 border-red-500/30';
      default: return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    }
  };

  const filteredOpportunities = selectedCategory === 'all' 
    ? opportunities 
    : opportunities.filter(opp => opp.category === selectedCategory);

  if (!isVisible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      >
        <Card 
          className="bg-gradient-to-br from-cyan-900 to-blue-900 border-cyan-500/50 shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-6 border-b border-cyan-500/30">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-cyan-500 rounded-xl flex items-center justify-center">
                  <Scan className="w-6 h-6 text-white animate-pulse" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-2xl">Altcoin Scanner</h3>
                  <p className="text-cyan-200 text-sm">Discovering opportunities across 100+ altcoins</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClose}
                className="text-white/70 hover:text-white hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>

          {/* Category Filter */}
          <div className="px-6 py-4 border-b border-cyan-500/30">
            <div className="flex gap-2 flex-wrap">
              <Button
                variant={selectedCategory === 'all' ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedCategory('all')}
                className={selectedCategory === 'all' ? "bg-cyan-600 text-white" : "border-cyan-400 bg-slate-800 text-cyan-300 hover:bg-cyan-600 hover:text-white"}
              >
                All ({opportunities.length})
              </Button>
              {getCategories().map(cat => {
                const count = opportunities.filter(o => o.category === cat).length;
                return (
                  <Button
                    key={cat}
                    variant={selectedCategory === cat ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedCategory(cat)}
                    className={selectedCategory === cat ? "bg-cyan-600 text-white" : "border-cyan-400 bg-slate-800 text-cyan-300 hover:bg-cyan-600 hover:text-white text-xs"}
                  >
                    {cat} ({count})
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Content */}
          <div className="overflow-y-auto p-6" style={{ maxHeight: "calc(90vh - 200px)" }}>
            {isLoading ? (
              <div className="py-12 text-center">
                <div className="inline-flex items-center gap-3">
                  <RefreshCw className="w-8 h-8 text-cyan-300 animate-spin" />
                  <span className="text-cyan-200 text-lg">Scanning altcoins...</span>
                </div>
              </div>
            ) : filteredOpportunities.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredOpportunities.map((opp, idx) => {
                  const riskLevel = opp.score >= 75 ? 'low' : opp.score >= 60 ? 'medium' : 'high';
                  const action = opp.signal === 'strong_buy' || opp.signal === 'buy' ? 'buy' : 'sell';

                  return (
                    <motion.div
                      key={opp.symbol}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10 hover:border-cyan-400/30 transition-all"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${getCategoryColor(opp.category)}`}>
                            <span className="text-xl font-bold">{opp.symbol.charAt(0)}</span>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-bold text-white">{opp.symbol}</h4>
                              <Badge className={
                                action === 'buy' 
                                  ? 'bg-green-500/20 text-green-300 border-green-500/30' 
                                  : 'bg-red-500/20 text-red-300 border-red-500/30'
                              }>
                                {action === 'buy' ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                                {opp.signal.replace('_', ' ').toUpperCase()}
                              </Badge>
                            </div>
                            <p className="text-cyan-200 text-sm">{opp.name}</p>
                          </div>
                        </div>
                        
                        <div className="text-right">
                          <div className="text-2xl font-bold text-cyan-400">
                            {opp.confidence}/100
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                        <div className="bg-black/20 rounded p-2">
                          <span className="text-slate-400">Momentum: </span>
                          <span className="text-white font-bold">{opp.momentum.toFixed(1)}%</span>
                        </div>
                        <div className="bg-black/20 rounded p-2">
                          <span className="text-slate-400">Vol Surge: </span>
                          <span className="text-white font-bold">{opp.volume_surge.toFixed(2)}x</span>
                        </div>
                        <div className="bg-black/20 rounded p-2">
                          <span className="text-slate-400">Score: </span>
                          <span className="text-white font-bold">{opp.score}/100</span>
                        </div>
                        <div className="bg-black/20 rounded p-2">
                          <span className="text-slate-400">Price: </span>
                          <span className="text-white font-bold">${opp.price.toFixed(4)}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex gap-2 flex-wrap">
                          <Badge className={getRiskColor(riskLevel)}>
                            {riskLevel} risk
                          </Badge>
                          <Badge className="bg-white/20 text-white border-white/30">
                            {opp.category}
                          </Badge>
                        </div>
                        
                        <Button
                          size="sm"
                          onClick={() => {
                            const asset = {
                              symbol: opp.symbol,
                              name: opp.name,
                              price: opp.price,
                              icon: opp.symbol.charAt(0),
                              color: getCategoryColor(opp.category)
                            };
                            onTradeAsset(asset, action);
                            handleClose();
                          }}
                          className={action === 'buy' 
                            ? 'bg-green-600 hover:bg-green-700' 
                            : 'bg-red-600 hover:bg-red-700'
                          }
                        >
                          Trade
                        </Button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-cyan-200">No opportunities found in this category</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-cyan-500/30">
            <Button
              variant="outline"
              onClick={runScan}
              disabled={isLoading}
              className="w-full border-cyan-400 bg-cyan-600 text-white hover:bg-cyan-700"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              {isLoading ? 'Scanning...' : 'Refresh Scan'}
            </Button>
          </div>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}