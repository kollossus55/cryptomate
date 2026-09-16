import React, { useState, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Newspaper, TrendingUp, TrendingDown, Clock, ExternalLink, Bell, Filter, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { fetchMarketIntelligence } from "./AdvancedSignalGenerator";

export default function NewsWidget({ assets, onNewsAlert, isCompact = false }) {
  const [newsFeed, setNewsFeed] = useState([]);
  const [selectedAsset, setSelectedAsset] = useState("all");
  const [sentimentFilter, setSentimentFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(false);
  
  // Refs to hold latest data for the interval callback
  const assetsRef = useRef(assets);
  const selectedAssetRef = useRef(selectedAsset);

  useEffect(() => {
    assetsRef.current = assets;
    selectedAssetRef.current = selectedAsset;
  }, [assets, selectedAsset]);

  // Memoize asset symbols to prevent refetching on price updates
  const assetSymbols = useMemo(() => assets.map(a => a.symbol).join(','), [assets]);

  useEffect(() => {
    if (assets && assets.length > 0) {
      fetchNewsForAssets();
      
      // Refresh news every 5 minutes
      const interval = setInterval(fetchNewsForAssets, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [assetSymbols, selectedAsset]);

  const fetchNewsForAssets = async () => {
    setIsLoading(true);
    try {
      const currentAssets = assetsRef.current;
      const currentSelected = selectedAssetRef.current;

      const assetsToFetch = currentSelected === "all"
        ? currentAssets.slice(0, 5) // Top 5 for "all" view
        : currentAssets.filter(a => a.symbol === currentSelected);

      const newsItems = [];
      const fetchedAt = new Date().toISOString(); // honest "retrieved at" time

      for (const asset of assetsToFetch) {
        // Real news only — live web search via backend function. No simulated fallback.
        const intelligence = await fetchMarketIntelligence(asset);
        const newsData = intelligence?.news || null;

        if (newsData && newsData.key_headlines?.length > 0) {
          newsData.key_headlines.forEach((headline, idx) => {
            newsItems.push({
              id: `${asset.symbol}-${idx}-${headline.substring(0, 20).replace(/\s+/g, '')}`,
              asset: asset.symbol,
              headline: headline,
              sentiment: newsData.sentiment_label,
              sentiment_score: newsData.sentiment_score,
              impact: newsData.impact_level,
              timestamp: fetchedAt,
              source: newsData.sources?.[idx] || "Web Search",
              summary: idx === 0 ? newsData.summary : null
            });
          });
        }
      }

      newsItems.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      setNewsFeed(newsItems);

      // Check for high-impact news and create alerts
      checkForSignificantNews(newsItems);
    } catch (error) {
      console.error("Failed to fetch news:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const checkForSignificantNews = async (newsItems) => {
    const highImpactNews = newsItems.filter(
      news => news.impact === 'high' && 
      (Math.abs(news.sentiment_score) > 0.5) &&
      (Date.now() - new Date(news.timestamp).getTime() < 3600000) // Within last hour
    );

    for (const news of highImpactNews) {
      if (onNewsAlert) {
        onNewsAlert(news);
      }

      // Create notification
      try {
        await base44.entities.Notification.create({
          notification_type: 'ai_anomaly',
          priority: 'high',
          title: `📰 High Impact News: ${news.asset}`,
          message: news.headline,
          data: {
            asset: news.asset,
            sentiment: news.sentiment,
            sentiment_score: news.sentiment_score,
            impact: news.impact,
            news_headline: news.headline
          }
        });
      } catch (error) {
        console.error("Failed to create news notification:", error);
      }
    }
  };

  const getSentimentColor = (sentiment) => {
    const sentimentMap = {
      'very_bullish': 'text-green-400 bg-green-500/20 border-green-500/40',
      'bullish': 'text-green-400 bg-green-500/10 border-green-500/30',
      'neutral': 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
      'bearish': 'text-red-400 bg-red-500/10 border-red-500/30',
      'very_bearish': 'text-red-400 bg-red-500/20 border-red-500/40'
    };
    return sentimentMap[sentiment] || sentimentMap.neutral;
  };

  const getSentimentIcon = (sentiment) => {
    if (sentiment.includes('bullish')) return <TrendingUp className="w-3 h-3" />;
    if (sentiment.includes('bearish')) return <TrendingDown className="w-3 h-3" />;
    return <Newspaper className="w-3 h-3" />;
  };

  const getTimeAgo = (timestamp) => {
    const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  const filteredNews = newsFeed.filter(news => {
    if (sentimentFilter === "all") return true;
    if (sentimentFilter === "bullish") return news.sentiment.includes('bullish');
    if (sentimentFilter === "bearish") return news.sentiment.includes('bearish');
    if (sentimentFilter === "neutral") return news.sentiment === 'neutral';
    return true;
  });

  if (isCompact) {
    return (
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-white text-lg flex items-center gap-2">
              <Newspaper className="w-5 h-5 text-indigo-400" />
              Market News
            </CardTitle>
            <Badge className="bg-indigo-500/20 text-indigo-400">
              {newsFeed.length} Stories
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-64">
            <div className="space-y-2">
              {filteredNews.slice(0, 5).map((news) => (
                <motion.div
                  key={news.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="p-3 bg-slate-800 rounded-lg border border-slate-700 hover:border-slate-600 transition-all cursor-pointer"
                >
                  <div className="flex items-start gap-2 mb-2">
                    <Badge className="bg-indigo-500/20 text-indigo-300 text-xs">
                      {news.asset}
                    </Badge>
                    <Badge className={`text-xs border ${getSentimentColor(news.sentiment)}`}>
                      {getSentimentIcon(news.sentiment)}
                      <span className="ml-1">{news.sentiment.replace('_', ' ')}</span>
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-300 mb-2">{news.headline}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {getTimeAgo(news.timestamp)}
                    </span>
                    <Badge className={news.impact === 'high' ? 'bg-orange-500/20 text-orange-400' : 'bg-slate-600 text-slate-300'}>
                      {news.impact} impact
                    </Badge>
                  </div>
                </motion.div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-slate-900 border-slate-700">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <CardTitle className="text-white flex items-center gap-2">
            <Newspaper className="w-5 h-5 text-indigo-400" />
            Market News & Sentiment
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchNewsForAssets}
              disabled={isLoading}
              className="border-indigo-500/50 text-indigo-400 hover:bg-indigo-500/10 hover:text-indigo-300 hover:border-indigo-500"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="all" className="w-full">
          <div className="flex items-center justify-between mb-4">
            <TabsList className="bg-slate-800">
              <TabsTrigger 
                value="all" 
                onClick={() => setSelectedAsset("all")}
                className="data-[state=active]:bg-indigo-600"
              >
                All Assets
              </TabsTrigger>
              {assets.slice(0, 5).map(asset => (
                <TabsTrigger
                  key={asset.symbol}
                  value={asset.symbol}
                  onClick={() => setSelectedAsset(asset.symbol)}
                  className="data-[state=active]:bg-indigo-600"
                >
                  {asset.symbol}
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" />
              <select
                value={sentimentFilter}
                onChange={(e) => setSentimentFilter(e.target.value)}
                className="bg-slate-800 text-white border border-slate-700 rounded px-3 py-1 text-sm"
              >
                <option value="all">All Sentiment</option>
                <option value="bullish">Bullish</option>
                <option value="bearish">Bearish</option>
                <option value="neutral">Neutral</option>
              </select>
            </div>
          </div>

          <ScrollArea className="h-96">
            <AnimatePresence>
              <div className="space-y-3">
                {filteredNews.length === 0 ? (
                  <div className="text-center py-8">
                    <Newspaper className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-400">No real-time news available right now.</p>
                    <p className="text-slate-500 text-xs mt-1">Live web search returned no headlines — try refreshing.</p>
                  </div>
                ) : (
                  filteredNews.map((news) => (
                    <motion.div
                      key={news.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      className="p-4 bg-slate-800 rounded-lg border border-slate-700 hover:border-indigo-500/50 transition-all"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Badge className="bg-indigo-500/20 text-indigo-300 font-bold">
                            {news.asset}
                          </Badge>
                          <Badge className={`border ${getSentimentColor(news.sentiment)}`}>
                            {getSentimentIcon(news.sentiment)}
                            <span className="ml-1 capitalize">{news.sentiment.replace('_', ' ')}</span>
                          </Badge>
                          {news.impact === 'high' && (
                            <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/40 animate-pulse">
                              HIGH IMPACT
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {getTimeAgo(news.timestamp)}
                        </span>
                      </div>

                      <h4 className="text-white font-semibold mb-2 text-base leading-snug">
                        {news.headline}
                      </h4>

                      {news.summary && (
                        <p className="text-sm text-slate-300 mb-3 leading-relaxed">
                          {news.summary}
                        </p>
                      )}

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-slate-400">
                            Sentiment Score: <span className={`font-bold ${news.sentiment_score > 0 ? 'text-green-400' : news.sentiment_score < 0 ? 'text-red-400' : 'text-yellow-400'}`}>
                              {(news.sentiment_score * 100).toFixed(0)}%
                            </span>
                          </span>
                          <span className="text-xs text-slate-500">
                            Source: {news.source}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-indigo-400 hover:text-indigo-300"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </Button>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </AnimatePresence>
          </ScrollArea>
        </Tabs>
      </CardContent>
    </Card>
  );
}