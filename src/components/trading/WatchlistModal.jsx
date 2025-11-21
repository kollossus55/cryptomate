import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Star, Search, TrendingUp, AlertCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";

export default function WatchlistModal({ assets, userPreferences, onClose }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [watchlist, setWatchlist] = useState([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (userPreferences?.watchlist) {
      setWatchlist(userPreferences.watchlist);
    }
  }, [userPreferences]);

  const saveWatchlistMutation = useMutation({
    mutationFn: async (newWatchlist) => {
      if (userPreferences?.id) {
        return await base44.entities.TradingPreferences.update(userPreferences.id, {
          ...userPreferences,
          watchlist: newWatchlist
        });
      } else {
        return await base44.entities.TradingPreferences.create({
          trading_style: "balanced",
          risk_tolerance: "moderate",
          watchlist: newWatchlist
        });
      }
    }
  });

  const toggleWatchlist = (symbol) => {
    setWatchlist(prev => 
      prev.includes(symbol) 
        ? prev.filter(s => s !== symbol)
        : [...prev, symbol]
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveWatchlistMutation.mutateAsync(watchlist);
      alert('Watchlist saved! Deep AI analysis will prioritize these assets.');
      onClose();
    } catch (error) {
      console.error('Failed to save watchlist:', error);
      alert('Failed to save watchlist. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const filteredAssets = assets.filter(asset =>
    asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    asset.symbol.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const watchlistedAssets = filteredAssets.filter(a => watchlist.includes(a.symbol));
  const otherAssets = filteredAssets.filter(a => !watchlist.includes(a.symbol));

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <Star className="w-6 h-6 text-yellow-400" />
            My Watchlist
            <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 ml-2">
              {watchlist.length} Assets
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Info Banner */}
          <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-3 flex gap-2">
            <TrendingUp className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-indigo-200 font-semibold mb-1">Priority AI Analysis</p>
              <p className="text-xs text-indigo-300">
                Assets in your watchlist get deep AI analysis first, including news sentiment, 
                social trends, and predictive modeling.
              </p>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search assets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-slate-800 border-slate-700 text-white"
            />
          </div>

          {/* Asset List */}
          <ScrollArea className="h-[400px]">
            <div className="space-y-2">
              {/* Watchlisted Assets */}
              {watchlistedAssets.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-2">
                    <Star className="w-3 h-3 text-yellow-400" />
                    ON WATCHLIST
                  </h3>
                  {watchlistedAssets.map(asset => (
                    <button
                      key={asset.symbol}
                      onClick={() => toggleWatchlist(asset.symbol)}
                      className="w-full bg-slate-800 hover:bg-slate-700 border border-yellow-500/50 rounded-lg p-3 transition-all flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${asset.color}`}>
                          <span className="text-lg">{asset.icon}</span>
                        </div>
                        <div className="text-left">
                          <div className="font-semibold text-white">{asset.symbol}</div>
                          <div className="text-xs text-slate-400">{asset.name}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right mr-2">
                          <div className="text-sm text-white">${asset.price.toLocaleString()}</div>
                          <div className={`text-xs ${asset.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {asset.change24h >= 0 ? '+' : ''}{asset.change24h.toFixed(2)}%
                          </div>
                        </div>
                        <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Other Assets */}
              {otherAssets.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-400 mb-2">
                    ALL ASSETS
                  </h3>
                  {otherAssets.map(asset => (
                    <button
                      key={asset.symbol}
                      onClick={() => toggleWatchlist(asset.symbol)}
                      className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg p-3 transition-all flex items-center justify-between mb-2"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${asset.color}`}>
                          <span className="text-lg">{asset.icon}</span>
                        </div>
                        <div className="text-left">
                          <div className="font-semibold text-white">{asset.symbol}</div>
                          <div className="text-xs text-slate-400">{asset.name}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right mr-2">
                          <div className="text-sm text-white">${asset.price.toLocaleString()}</div>
                          <div className={`text-xs ${asset.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {asset.change24h >= 0 ? '+' : ''}{asset.change24h.toFixed(2)}%
                          </div>
                        </div>
                        <Star className="w-5 h-5 text-slate-600" />
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {filteredAssets.length === 0 && (
                <div className="text-center py-8 text-slate-400">
                  No assets found matching "{searchQuery}"
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-slate-700">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 border-slate-600 bg-slate-800 text-white hover:bg-slate-700"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 bg-gradient-to-br from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white"
            >
              {isSaving ? 'Saving...' : `Save Watchlist (${watchlist.length})`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}