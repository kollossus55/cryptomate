import React, { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Sparkles, BarChart3, Trophy, Clock, ArrowUpCircle, ArrowDownCircle } from "lucide-react";
import { motion } from "framer-motion";

import NewsSentimentIndicator from "./NewsSentimentIndicator";

export default function AssetCard({ asset, rank, onTrade, onAnalyze }) {
  const isPositive = (asset.change24h || 0) >= 0;
  const price = asset.price || 0;
  const change24h = asset.change24h || 0;
  const volume24h = asset.volume24h || 0;
  const marketCap = asset.marketCap || 0;
  const confidence = asset.confidence || 50;
  
  // Get signal data from window storage (includes recommendation and timestamp)
  const signalData = window.assetSignalData?.[asset.symbol];
  const recommendation = signalData?.recommendation || 'hold';
  const signalTimestamp = signalData?.timestamp || Date.now();
  
  // Get news sentiment data
  const newsData = signalData?.breakdown?.news;
  const newsSentiment = newsData?.sentiment_label;
  const newsSentimentScore = newsData?.sentiment_score;
  const newsImpact = newsData?.impact_level;
  
  // Calculate time ago
  const getTimeAgo = (timestamp) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };
  
  // Confidence color coding
  const getConfidenceColor = (conf) => {
    if (conf >= 80) return "bg-green-500/20 text-green-400 border-green-500/50";
    if (conf >= 65) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/50";
    return "bg-red-500/20 text-red-400 border-red-500/50";
  };

  // Rank badge color
  const getRankColor = (r) => {
    if (r === 1) return "bg-yellow-500 text-black";
    if (r === 2) return "bg-slate-300 text-black";
    if (r === 3) return "bg-amber-600 text-white";
    return "bg-slate-700 text-slate-300";
  };
  
  // Recommendation badge color
  const getRecommendationColor = (rec) => {
    if (rec === 'buy') return "bg-green-500/20 text-green-400 border-green-500/40";
    if (rec === 'sell') return "bg-red-500/20 text-red-400 border-red-500/40";
    return "bg-slate-500/20 text-slate-400 border-slate-500/40";
  };
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700 hover:border-indigo-500 transition-all duration-300 relative overflow-hidden">
        {/* Rank Badge */}
        {rank <= 3 && (
          <div className="absolute top-2 right-2">
            <Badge className={`${getRankColor(rank)} font-bold flex items-center gap-1`}>
              <Trophy className="w-3 h-3" />
              #{rank}
            </Badge>
          </div>
        )}

        {/* High Impact News Indicator */}
        {newsImpact === 'high' && (
          <div className="absolute top-2 left-2">
            <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/40 animate-pulse">
              📰 Breaking
            </Badge>
          </div>
        )}

        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${asset.color || 'bg-slate-600'}`}>
                <span className="text-lg font-bold text-white">{asset.icon || '?'}</span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-white text-lg">{asset.symbol || 'N/A'}</h3>
                  {rank > 3 && (
                    <span className="text-xs text-slate-500">#{rank}</span>
                  )}
                </div>
                <p className="text-sm text-slate-400">{asset.name || 'Unknown'}</p>
              </div>
            </div>
            {isPositive ? (
              <TrendingUp className="w-5 h-5 text-green-400" />
            ) : (
              <TrendingDown className="w-5 h-5 text-red-400" />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* AI Confidence Badge with Timestamp */}
          <div className="flex items-center justify-between gap-2">
            <Badge className={`${getConfidenceColor(confidence)} border-2 font-bold px-3 py-1 flex items-center gap-1`}>
              <Sparkles className="w-3 h-3" />
              {confidence}% Confidence
            </Badge>
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <Clock className="w-3 h-3" />
              {getTimeAgo(signalTimestamp)}
            </div>
          </div>

          {/* News Sentiment Indicator */}
          {newsSentiment && newsSentimentScore !== undefined && (
            <NewsSentimentIndicator
              asset={asset.symbol}
              sentiment={newsSentiment}
              score={newsSentimentScore}
              impact={newsImpact}
              showDetails={false}
            />
          )}

          {/* AI Recommendation Badge */}
          <div>
            <Badge className={`${getRecommendationColor(recommendation)} border-2 font-bold px-3 py-1.5 flex items-center gap-1.5 w-full justify-center`}>
              {recommendation === 'buy' && <ArrowUpCircle className="w-4 h-4" />}
              {recommendation === 'sell' && <ArrowDownCircle className="w-4 h-4" />}
              {recommendation === 'hold' && <BarChart3 className="w-4 h-4" />}
              AI Signal: {recommendation.toUpperCase()}
            </Badge>
          </div>

          {/* Technical Indicator Signal Display */}
          {window.assetSignalData?.[asset.symbol]?.technicalDetails?.signals?.length > 0 && (
            <div className="mt-1 text-center">
              <span className="text-[10px] uppercase font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                {window.assetSignalData[asset.symbol].technicalDetails.signals[0]}
              </span>
            </div>
          )}

          <div>
            <div className="text-2xl font-bold text-white mb-1">
              ${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
            </div>
            <div className={`text-sm font-medium flex items-center gap-1 ${
              isPositive ? 'text-green-400' : 'text-red-400'
            }`}>
              {isPositive ? '+' : ''}{change24h.toFixed(2)}% (24h)
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-slate-400">Volume</p>
              <p className="text-white font-medium">${(volume24h / 1e9).toFixed(2)}B</p>
            </div>
            <div>
              <p className="text-slate-400">Market Cap</p>
              <p className="text-white font-medium">${(marketCap / 1e9).toFixed(2)}B</p>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              onClick={() => onTrade(asset, 'buy')}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              disabled={recommendation === 'sell'}
            >
              Buy
            </Button>
            <Button
              onClick={() => onTrade(asset, 'sell')}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white"
              disabled={recommendation === 'buy'}
            >
              Sell
            </Button>
            <Button
              onClick={() => onAnalyze(asset)}
              variant="outline"
              className="border-indigo-500 text-indigo-400 hover:bg-indigo-500/10"
              title="Advanced Analysis"
            >
              <BarChart3 className="w-4 h-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}