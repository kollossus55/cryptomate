import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, TrendingUp, Sparkles, RefreshCw, AlertCircle, Settings, Eye, EyeOff, Newspaper, Scan, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

import AssetCard from "../components/trading/AssetCard";
import TradeModal from "../components/trading/TradeModal";
import AIAnalysisModal from "../components/trading/AIAnalysisModal";
import AIRecommendationNotification from "../components/trading/AIRecommendationNotification";
import AltcoinScannerModal from "../components/trading/AltcoinScannerModal";
import IndicatorSettingsModal from "../components/trading/IndicatorSettingsModal";
import WatchlistModal from "../components/trading/WatchlistModal";
import PortfolioCard from "../components/trading/PortfolioCard";
import NotificationToast from "../components/notifications/NotificationToast";
import { useNotificationMonitor } from "../components/notifications/useNotificationMonitor";
import { generateAdvancedSignal } from "../components/trading/AdvancedSignalGenerator";
import AutoTradingDebugPanel from "../components/trading/AutoTradingDebugPanel";
import BackendMigrationGuide from "../components/trading/BackendMigrationGuide";
import NewsWidget from "../components/trading/NewsWidget";
import SystemHealthMonitor from "../components/trading/SystemHealthMonitor";
import AITradingAdvisor from "../components/trading/AITradingAdvisor";
import SignalAlertSettings from "../components/trading/SignalAlertSettings";
import ConfluenceSignalScanner from "../components/trading/ConfluenceSignalScanner";

import {
  executeAutoTradingCheckAdvanced,
  formatOpportunityLog,
  BrowserState
} from "../components/trading/autoTradingEngine";

import { executeSmartOrder } from "../components/trading/smartOrderExecution";
import { scanAltcoins } from "../components/trading/AltcoinScanner";
import { useOkxWebSocket } from "../components/trading/useOkxWebSocket";

export default function Trading() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [tradeType, setTradeType] = useState(null);
  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false);
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);
  const [analysisAsset, setAnalysisAsset] = useState(null);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [showAltcoinScanner, setShowAltcoinScanner] = useState(false);
  const [altcoinScannerEnabled, setAltcoinScannerEnabled] = useState(() => {
    const saved = localStorage.getItem('altcoin_scanner_enabled');
    return saved === 'true';
  });
  const [altcoinPrefSynced, setAltcoinPrefSynced] = useState(false);
  const [isPriceLoading, setIsPriceLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [assetConfidence, setAssetConfidence] = useState({});
  const [isPageVisible, setIsPageVisible] = useState(true);
  const [showVisibilityWarning, setShowVisibilityWarning] = useState(false);
  const [showNewsWidget, setShowNewsWidget] = useState(true);
  const [showWatchlistModal, setShowWatchlistModal] = useState(false);
  const [userPreferences, setUserPreferences] = useState(null);
  const [altcoinOpportunities, setAltcoinOpportunities] = useState([]);
  const [lastScanResult, setLastScanResult] = useState(null);
  const [lastScanTime, setLastScanTime] = useState(null);
  const [currentMarketCondition, setCurrentMarketCondition] = useState('normal');
  const [showIndicatorSettings, setShowIndicatorSettings] = useState(false);
  const [indicatorSettings, setIndicatorSettings] = useState(() => {
    const saved = localStorage.getItem('indicator_settings');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse saved indicator settings');
      }
    }
    return {
      rsi: true,
      macd: true,
      bollinger: true,
      ema: true,
      stoch: true,
      adx: true,
      sma: true,
      ao: true,
      aroon: true,
      candlestick: true,
      ichimoku: true
    };
  });

  const queryClient = useQueryClient();

  // Save indicator settings to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('indicator_settings', JSON.stringify(indicatorSettings));
    console.log('💾 Saved indicator settings:', indicatorSettings);
  }, [indicatorSettings]);

  // Persist altcoin scanner toggle to localStorage AND backend so it survives reloads
  useEffect(() => {
    localStorage.setItem('altcoin_scanner_enabled', String(altcoinScannerEnabled));
  }, [altcoinScannerEnabled]);

  const toggleAltcoinScanner = async (enabled) => {
    setAltcoinScannerEnabled(enabled);
    localStorage.setItem('altcoin_scanner_enabled', String(enabled));
    try {
      if (preferences?.id) {
        await base44.entities.TradingPreferences.update(preferences.id, {
          altcoin_scanner_enabled: enabled
        });
      } else {
        await base44.entities.TradingPreferences.create({
          trading_style: 'balanced',
          risk_tolerance: 'moderate',
          altcoin_scanner_enabled: enabled
        });
      }
      queryClient.invalidateQueries({ queryKey: ['trading-preferences'] });
    } catch (error) {
      console.error('Failed to persist altcoin scanner toggle:', error);
    }
  };

  // Fetch user preferences
  const { data: preferences } = useQuery({
    queryKey: ['trading-preferences'],
    queryFn: async () => {
      const prefs = await base44.entities.TradingPreferences.list();
      return prefs && prefs.length > 0 ? prefs[0] : null;
    },
    staleTime: 60000,
  });

  useEffect(() => {
    if (preferences) {
      setUserPreferences(preferences);
      // Sync altcoin scanner toggle from backend (authoritative) once on load
      if (!altcoinPrefSynced && typeof preferences.altcoin_scanner_enabled === 'boolean') {
        setAltcoinScannerEnabled(preferences.altcoin_scanner_enabled);
        localStorage.setItem('altcoin_scanner_enabled', String(preferences.altcoin_scanner_enabled));
        setAltcoinPrefSynced(true);
      }
    }
  }, [preferences, altcoinPrefSynced]);

  const coinGeckoIds = {
    BTC: "bitcoin",
    ETH: "ethereum",
    BNB: "binancecoin",
    SOL: "solana",
    XRP: "ripple",
    ADA: "cardano",
    AVAX: "avalanche-2",
    DOGE: "dogecoin",
    DOT: "polkadot",
    MATIC: "matic-network",
    LTC: "litecoin",
    LINK: "chainlink",
    UNI: "uniswap",
    ATOM: "cosmos",
    XLM: "stellar",
    ALGO: "algorand",
    VET: "vechain",
    FIL: "filecoin",
    NEAR: "near",
    APT: "aptos",
    ARB: "arbitrum",
    OP: "optimism",
    INJ: "injective-protocol",
    TIA: "celestia",
    SUI: "sui",
    SEI: "sei-network",
    HBAR: "hedera-hashgraph",
    STX: "blockstack",
    IMX: "immutable-x",
    RUNE: "thorchain",
    AAVE: "aave",
    MKR: "maker",
    LDO: "lido-dao",
    CRV: "curve-dao-token",
    SNX: "havven",
    GRT: "the-graph",
    SAND: "the-sandbox",
    MANA: "decentraland",
    APE: "apecoin",
    AXS: "axie-infinity",
    FTM: "fantom",
    EGLD: "elrond-erd-2",
    THETA: "theta-token",
    XTZ: "tezos",
    EOS: "eos",
    FLOW: "flow",
    ICP: "internet-computer",
    QNT: "quant-network",
    PEPE: "pepe",
    WIF: "dogwifcoin"
  };

  const initialAssets = [
    { symbol: "BTC", name: "Bitcoin", price: 44084.92, change24h: 2.45, volume24h: 28000000000, marketCap: 860000000000, icon: "₿", color: "bg-orange-500" },
    { symbol: "ETH", name: "Ethereum", price: 2316.18, change24h: -1.23, volume24h: 15000000000, marketCap: 278000000000, icon: "Ξ", color: "bg-blue-500" },
    { symbol: "BNB", name: "Binance Coin", price: 308.45, change24h: 1.87, volume24h: 1200000000, marketCap: 47000000000, icon: "◆", color: "bg-yellow-500" },
    { symbol: "SOL", name: "Solana", price: 99.24, change24h: 5.67, volume24h: 2400000000, marketCap: 42000000000, icon: "◎", color: "bg-purple-500" },
    { symbol: "XRP", name: "Ripple", price: 0.62, change24h: 3.21, volume24h: 1800000000, marketCap: 33000000000, icon: "✕", color: "bg-slate-500" },
    { symbol: "ADA", name: "Cardano", price: 0.58, change24h: -2.14, volume24h: 980000000, marketCap: 20000000000, icon: "₳", color: "bg-blue-600" },
    { symbol: "AVAX", name: "Avalanche", price: 36.87, change24h: 4.32, volume24h: 750000000, marketCap: 13500000000, icon: "▲", color: "bg-red-500" },
    { symbol: "DOGE", name: "Dogecoin", price: 0.092, change24h: 1.55, volume24h: 650000000, marketCap: 13000000000, icon: "Ð", color: "bg-yellow-600" },
    { symbol: "DOT", name: "Polkadot", price: 7.23, change24h: -0.89, volume24h: 420000000, marketCap: 9200000000, icon: "●", color: "bg-pink-500" },
    { symbol: "MATIC", name: "Polygon", price: 0.89, change24h: 2.78, volume24h: 580000000, marketCap: 8300000000, icon: "⬡", color: "bg-purple-600" },
    { symbol: "LTC", name: "Litecoin", price: 72.45, change24h: 0.92, volume24h: 440000000, marketCap: 5400000000, icon: "Ł", color: "bg-slate-400" },
    { symbol: "LINK", name: "Chainlink", price: 14.87, change24h: 3.45, volume24h: 520000000, marketCap: 8200000000, icon: "⬢", color: "bg-blue-400" },
    { symbol: "UNI", name: "Uniswap", price: 6.34, change24h: -1.67, volume24h: 280000000, marketCap: 4800000000, icon: "🦄", color: "bg-pink-600" },
    { symbol: "ATOM", name: "Cosmos", price: 10.23, change24h: 2.11, volume24h: 310000000, marketCap: 4000000000, icon: "⚛", color: "bg-indigo-500" },
    { symbol: "XLM", name: "Stellar", price: 0.13, change24h: 1.34, volume24h: 190000000, marketCap: 3700000000, icon: "✦", color: "bg-cyan-500" },
    { symbol: "ALGO", name: "Algorand", price: 0.19, change24h: -0.56, volume24h: 150000000, marketCap: 1500000000, icon: "△", color: "bg-teal-500" },
    { symbol: "VET", name: "VeChain", price: 0.028, change24h: 4.21, volume24h: 120000000, marketCap: 2100000000, icon: "V", color: "bg-blue-700" },
    { symbol: "FIL", name: "Filecoin", price: 5.67, change24h: -2.34, volume24h: 180000000, marketCap: 3200000000, icon: "⨎", color: "bg-cyan-600" },
    { symbol: "NEAR", name: "NEAR Protocol", price: 2.87, change24h: 3.89, volume24h: 240000000, marketCap: 3000000000, icon: "N", color: "bg-green-600" },
    { symbol: "APT", name: "Aptos", price: 11.42, change24h: 6.23, volume24h: 290000000, marketCap: 4500000000, icon: "A", color: "bg-emerald-500" },
    { symbol: "ARB", name: "Arbitrum", price: 1.23, change24h: 2.34, volume24h: 380000000, marketCap: 5600000000, icon: "🔷", color: "bg-blue-500" },
    { symbol: "OP", name: "Optimism", price: 2.45, change24h: 3.12, volume24h: 290000000, marketCap: 4100000000, icon: "🔴", color: "bg-red-600" },
    { symbol: "INJ", name: "Injective", price: 28.34, change24h: 5.67, volume24h: 220000000, marketCap: 3800000000, icon: "💉", color: "bg-cyan-600" },
    { symbol: "TIA", name: "Celestia", price: 8.92, change24h: 4.23, volume24h: 180000000, marketCap: 2900000000, icon: "🌟", color: "bg-purple-400" },
    { symbol: "SUI", name: "Sui", price: 1.87, change24h: 6.45, volume24h: 310000000, marketCap: 5200000000, icon: "🌊", color: "bg-blue-400" },
    { symbol: "SEI", name: "Sei", price: 0.67, change24h: 3.89, volume24h: 140000000, marketCap: 2100000000, icon: "⚡", color: "bg-red-400" },
    { symbol: "HBAR", name: "Hedera", price: 0.084, change24h: 2.11, volume24h: 160000000, marketCap: 3400000000, icon: "ℏ", color: "bg-slate-600" },
    { symbol: "STX", name: "Stacks", price: 1.92, change24h: 4.56, volume24h: 120000000, marketCap: 2800000000, icon: "⟁", color: "bg-orange-600" },
    { symbol: "IMX", name: "Immutable X", price: 2.34, change24h: 3.21, volume24h: 95000000, marketCap: 2300000000, icon: "✕", color: "bg-cyan-700" },
    { symbol: "RUNE", name: "THORChain", price: 5.67, change24h: 2.89, volume24h: 110000000, marketCap: 2000000000, icon: "⚔", color: "bg-green-700" },
    { symbol: "AAVE", name: "Aave", price: 98.45, change24h: 1.23, volume24h: 180000000, marketCap: 1900000000, icon: "👻", color: "bg-pink-500" },
    { symbol: "MKR", name: "Maker", price: 1567.23, change24h: -0.89, volume24h: 85000000, marketCap: 1800000000, icon: "🏛", color: "bg-green-500" },
    { symbol: "LDO", name: "Lido DAO", price: 2.89, change24h: 3.45, volume24h: 140000000, marketCap: 2600000000, icon: "🛡", color: "bg-blue-600" },
    { symbol: "CRV", name: "Curve DAO", price: 0.87, change24h: 2.11, volume24h: 95000000, marketCap: 1100000000, icon: "🔁", color: "bg-blue-500" },
    { symbol: "SNX", name: "Synthetix", price: 3.45, change24h: 4.32, volume24h: 78000000, marketCap: 1400000000, icon: "⚗", color: "bg-purple-600" },
    { symbol: "GRT", name: "The Graph", price: 0.23, change24h: 1.89, volume24h: 92000000, marketCap: 2200000000, icon: "📊", color: "bg-indigo-600" },
    { symbol: "SAND", name: "The Sandbox", price: 0.56, change24h: 3.12, volume24h: 110000000, marketCap: 1300000000, icon: "🏝", color: "bg-yellow-400" },
    { symbol: "MANA", name: "Decentraland", price: 0.67, change24h: 2.45, volume24h: 88000000, marketCap: 1200000000, icon: "🏛", color: "bg-red-500" },
    { symbol: "APE", name: "ApeCoin", price: 1.89, change24h: 4.67, volume24h: 125000000, marketCap: 1500000000, icon: "🐵", color: "bg-blue-700" },
    { symbol: "AXS", name: "Axie Infinity", price: 8.34, change24h: 2.89, volume24h: 95000000, marketCap: 1100000000, icon: "🎮", color: "bg-pink-600" },
    { symbol: "FTM", name: "Fantom", price: 0.45, change24h: 3.56, volume24h: 140000000, marketCap: 1800000000, icon: "👻", color: "bg-blue-500" },
    { symbol: "EGLD", name: "MultiversX", price: 42.67, change24h: 1.78, volume24h: 75000000, marketCap: 1600000000, icon: "⚡", color: "bg-cyan-500" },
    { symbol: "THETA", name: "Theta Network", price: 1.23, change24h: 2.34, volume24h: 68000000, marketCap: 1200000000, icon: "θ", color: "bg-indigo-500" },
    { symbol: "XTZ", name: "Tezos", price: 1.12, change24h: 1.45, volume24h: 82000000, marketCap: 1100000000, icon: "ꜩ", color: "bg-blue-600" },
    { symbol: "EOS", name: "EOS", price: 0.89, change24h: 2.11, volume24h: 95000000, marketCap: 1000000000, icon: "Ξ", color: "bg-slate-700" },
    { symbol: "FLOW", name: "Flow", price: 1.45, change24h: 3.21, volume24h: 72000000, marketCap: 1500000000, icon: "🌊", color: "bg-green-500" },
    { symbol: "ICP", name: "Internet Computer", price: 5.67, change24h: 4.12, volume24h: 110000000, marketCap: 2700000000, icon: "∞", color: "bg-purple-500" },
    { symbol: "QNT", name: "Quant", price: 112.34, change24h: 1.89, volume24h: 65000000, marketCap: 1400000000, icon: "Q", color: "bg-slate-600" },
    { symbol: "PEPE", name: "Pepe", price: 0.0000089, change24h: 8.92, volume24h: 420000000, marketCap: 3700000000, icon: "🐸", color: "bg-green-400" },
    { symbol: "WIF", name: "dogwifhat", price: 2.87, change24h: 7.23, volume24h: 280000000, marketCap: 2900000000, icon: "🐕", color: "bg-orange-400" }
  ];

  const [assets, setAssets] = useState(initialAssets);
  const [lastPriceUpdate, setLastPriceUpdate] = useState(null);
  const [priceUpdateError, setPriceUpdateError] = useState(null);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [signalFilter, setSignalFilter] = React.useState("all");
  const [sortBy, setSortBy] = React.useState("confidence");

  // Integrate WebSocket for real-time updates
  const symbolList = React.useMemo(() => initialAssets.map(a => a.symbol), []);
  const { livePrices, liveTickers, isConnected: isWsConnected } = useOkxWebSocket(symbolList);

  // Update assets from real Binance miniTicker stream (price, 24h change, quote volume)
  useEffect(() => {
    if (Object.keys(liveTickers).length > 0) {
      setAssets(prevAssets => prevAssets.map(asset => {
        const t = liveTickers[asset.symbol];
        if (t) {
          return {
            ...asset,
            price: t.price ?? asset.price,
            change24h: t.change24h ?? asset.change24h,
            volume24h: t.volume24h ?? asset.volume24h
          };
        }
        return asset;
      }));
    }
  }, [liveTickers]);

  const { activeToast, clearToast } = useNotificationMonitor(assets);

  const initializePortfolio = async () => {
    try {
      const portfolios = await base44.entities.Portfolio.list();
      if (portfolios.length === 0) {
        await base44.entities.Portfolio.create({
          total_balance: 10000,
          available_balance: 10000,
          positions: [],
          total_profit_loss: 0,
          total_trades: 0
        });
      }
    } catch (error) {
      console.error("Failed to initialize portfolio:", error);
    }
  };

  const { data: portfolio } = useQuery({
    queryKey: ['portfolio'],
    queryFn: async () => {
      const result = await base44.entities.Portfolio.list();
      return result[0] || null;
    },
    staleTime: 30000,
    retry: 1,
  });

  const { data: trades } = useQuery({
    queryKey: ['trades'],
    queryFn: () => base44.entities.Trade.list('-created_date', 50),
    initialData: [],
    staleTime: 30000,
    retry: 1,
  });

  const createTradeMutation = useMutation({
    mutationFn: (tradeData) => base44.entities.Trade.create(tradeData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trades'] });
    },
  });

  const updatePortfolioMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Portfolio.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
    },
  });

  const { data: autoTradingSettings } = useQuery({
    queryKey: ['auto-trading-settings'],
    queryFn: async () => {
      const result = await base44.entities.AutoTradingSettings.list();
      return result[0];
    },
    refetchInterval: 30000,
    staleTime: 15000,
    retry: 1,
  });



  const resetPortfolioMutation = useMutation({
    mutationFn: async () => {
      if (portfolio?.id) {
        await base44.entities.Portfolio.update(portfolio.id, {
          total_balance: 10000,
          available_balance: 10000,
          positions: [],
          total_profit_loss: 0,
          total_trades: 0
        });
      }

      // Fetch settings directly to ensure we have the latest ID and handle the reset even if UI state is stale
      // We iterate through ALL settings records to ensure we catch any duplicates or the correct active one
      const settingsList = await base44.entities.AutoTradingSettings.list();
      
      if (settingsList && settingsList.length > 0) {
        console.log(`Resetting auto-trading counters for ${settingsList.length} settings records...`);
        await Promise.all(settingsList.map(settings => 
          base44.entities.AutoTradingSettings.update(settings.id, {
            trades_today: 0,
            daily_loss: 0,
            last_trade_date: null,
            assets_traded_today: []
          })
        ));
      }

      // Delete existing trades to fully reset history
      console.log("Deleting trade history...");
      let allTrades = [];
      let hasMore = true;
      let skip = 0;
      const batchSize = 100;

      // Fetch all trades in batches
      while (hasMore) {
        const batch = await base44.entities.Trade.list(null, batchSize);
        if (batch && batch.length > 0) {
          allTrades = [...allTrades, ...batch];
          skip += batchSize;
          hasMore = batch.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      console.log(`Found ${allTrades.length} trades to delete`);
      if (allTrades.length > 0) {
        await Promise.all(allTrades.map(trade => base44.entities.Trade.delete(trade.id)));
        console.log(`✅ Deleted ${allTrades.length} trades`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['auto-trading-settings'] });
    },
  });

  useEffect(() => {
    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible';
      setIsPageVisible(visible);

      if (!visible && autoTradingSettings?.is_enabled) {
        setShowVisibilityWarning(true);
        console.log('ℹ️ Page hidden - auto-trading continuing via background worker');
      } else if (visible && autoTradingSettings?.is_enabled) {
        console.log('✅ Page visible - auto-trading resumed');
        const savedState = BrowserState.load();
        if (savedState) {
          console.log('📥 Restored auto-trading state from storage');
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [autoTradingSettings]);

  useEffect(() => {
    initializePortfolio();
    fetchLivePrices();
    
    setTimeout(() => {
      calculateAIConfidence();
    }, 5000);

    const priceInterval = setInterval(fetchLivePrices, 60000);
    const timeInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    const timer = setTimeout(() => {
      setShowRecommendations(true);
    }, 2000);

    const savedState = BrowserState.load();
    if (savedState && autoTradingSettings?.is_enabled) {
      console.log('📥 Auto-trading state restored from previous session');
    }

    // NOTE: The background altcoin scanner was removed. An earlier version
    // generated fake prices and injected them into the trading pool and
    // window.assetSignalData, which produced fake trades with inflated
    // profits. Only the V5 server worker executes trades now, using real
    // Binance OHLCV data. The AltcoinScannerModal remains available as a
    // manual, on-demand UI feature.

    return () => {
      clearInterval(priceInterval);
      clearInterval(timeInterval);
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (assets && assets.length > 0) {
      const debounceTimer = setTimeout(() => {
        calculateAIConfidence();
      }, 3000);
      
      return () => clearTimeout(debounceTimer);
    }
  }, [assets]);

  const handleExecuteTrade = async ({ asset, tradeType, quantity, price, totalValue, riskManagement }) => {
    const slippage = 0.001 + (Math.random() * 0.001);
    const slippageAmount = tradeType === 'buy' ? slippage : -slippage;
    const executionPrice = price * (1 + slippageAmount);
    const actualTotal = quantity * executionPrice;

    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));

    if (!portfolio) return;

    let profitLoss = 0;
    let updatedPositions = [...(portfolio.positions || [])];

    const assetSymbol = `${asset.symbol}/USDT`;
    // Match positions regardless of symbol format:
    //  - Frontend manual trades: "BTC/USDT" (with slash)
    //  - Server worker trades:  "BTCUSDT"  (no slash)
    //  - Legacy / edge cases:    raw "BTC"
    const positionIndex = updatedPositions.findIndex(p =>
      p.asset_symbol === assetSymbol ||
      p.asset_symbol === `${asset.symbol}USDT` ||
      p.asset_symbol === asset.symbol
    );
    const existingPosition = positionIndex >= 0 ? updatedPositions[positionIndex] : null;

    if (tradeType === 'buy') {
      if (existingPosition) {
        const totalQuantity = existingPosition.quantity + quantity;
        const totalCost = (existingPosition.quantity * existingPosition.avg_entry_price) + actualTotal;
        const newAvgPrice = totalCost / totalQuantity;

        updatedPositions[positionIndex] = {
          asset_symbol: assetSymbol,
          quantity: totalQuantity,
          avg_entry_price: newAvgPrice,
          current_value: totalQuantity * executionPrice,
          profit_loss: (executionPrice - newAvgPrice) * totalQuantity,
          highest_price: executionPrice,
          trailing_stop_price: null,
          breakeven_activated: false,
          // Preserve or update risk management settings
          risk_management: riskManagement || existingPosition.risk_management
        };
      } else {
        updatedPositions.push({
          asset_symbol: assetSymbol,
          quantity: quantity,
          avg_entry_price: executionPrice,
          current_value: actualTotal,
          profit_loss: 0,
          highest_price: executionPrice,
          trailing_stop_price: null,
          breakeven_activated: false,
          // Store risk management settings for manual trades
          risk_management: riskManagement
        });
      }
      profitLoss = 0;
    } else {
      if (existingPosition) {
        const sellQuantity = Math.min(quantity, existingPosition.quantity);
        profitLoss = (executionPrice - existingPosition.avg_entry_price) * sellQuantity;

        if (sellQuantity >= existingPosition.quantity) {
          updatedPositions.splice(positionIndex, 1);
        } else {
          const remainingQuantity = existingPosition.quantity - sellQuantity;
          updatedPositions[positionIndex] = {
            ...existingPosition,
            quantity: remainingQuantity,
            current_value: remainingQuantity * executionPrice,
            profit_loss: (executionPrice - existingPosition.avg_entry_price) * remainingQuantity
          };
        }
      } else {
        profitLoss = 0;
      }
    }

    await createTradeMutation.mutateAsync({
      asset_symbol: assetSymbol,
      trade_type: tradeType,
      quantity: quantity,
      price: executionPrice,
      total_value: actualTotal,
      exchange: "Paper Trading",
      status: "completed",
      profit_loss: profitLoss
    });

    const newBalance = tradeType === 'buy'
      ? portfolio.available_balance - actualTotal
      : portfolio.available_balance + actualTotal;

    await updatePortfolioMutation.mutateAsync({
      id: portfolio.id,
      data: {
        total_balance: portfolio.total_balance + profitLoss,
        available_balance: newBalance,
        positions: updatedPositions,
        total_profit_loss: (portfolio.total_profit_loss || 0) + profitLoss,
        total_trades: (portfolio.total_trades || 0) + 1
      }
    });

    await base44.entities.Notification.create({
      notification_type: 'order_filled',
      priority: 'medium',
      title: 'Order Filled',
      message: `${tradeType.toUpperCase()} order for ${quantity.toFixed(6)} ${asset.symbol} filled at $${executionPrice.toFixed(2)}`,
      data: {
        asset: asset.symbol,
        type: tradeType,
        quantity: quantity,
        price: executionPrice,
        total: actualTotal,
        profit_loss: profitLoss
      }
    });
  };

  const handleAutoTrade = async (asset, tradeType, quantity, confidence, riskLevel) => {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        console.log(`🤖 AUTO-TRADE INITIATED: ${tradeType.toUpperCase()} ${quantity.toFixed(6)} ${asset.symbol} @ $${asset.price.toLocaleString()} (${confidence}% confidence) [Attempt ${attempt + 1}/${maxRetries}]`);

        await handleExecuteTrade({
          asset,
          tradeType,
          quantity,
          price: asset.price,
          totalValue: quantity * asset.price
        });

        console.log(`✅ AUTO-TRADE COMPLETED: ${tradeType.toUpperCase()} ${quantity.toFixed(6)} ${asset.symbol} successfully executed`);

        const currentSettings = autoTradingSettings;
        if (!currentSettings || !currentSettings.id) {
          console.error("⚠️ Auto-trading settings not found or has no ID for update.");
          return;
        }

        const newTradesCount = (currentSettings.trades_today || 0) + 1;
        const assetsTraded = [...(currentSettings.assets_traded_today || [])];
        if (tradeType === 'buy' && !assetsTraded.includes(asset.symbol)) {
          assetsTraded.push(asset.symbol);
          console.log(`📊 Added ${asset.symbol} to today's traded assets list (${assetsTraded.length} total)`);
        }

        await base44.entities.AutoTradingSettings.update(currentSettings.id, {
          ...currentSettings,
          trades_today: newTradesCount,
          last_trade_date: new Date().toISOString(),
          assets_traded_today: assetsTraded
        });

        console.log(`📊 Updated trade counters: ${newTradesCount}/${currentSettings.max_trades_per_day || 10} trades today`);

        await base44.entities.Notification.create({
          notification_type: 'order_filled',
          priority: 'high',
          title: '🤖 Auto-Trade Executed',
          message: `Automatically ${tradeType === 'buy' ? 'bought' : 'sold'} ${quantity.toFixed(6)} ${asset.symbol} at $${asset.price.toLocaleString()} (${confidence}% confidence)`,
          data: {
            asset: asset.symbol,
            type: tradeType,
            quantity: quantity,
            price: asset.price,
            confidence: confidence,
            risk_level: riskLevel,
            auto_trade: true
          }
        });

        queryClient.invalidateQueries({ queryKey: ['auto-trading-settings'] });
        break;
      } catch (error) {
        attempt++;
        console.error(`❌ AUTO-TRADE FAILED (Attempt ${attempt}/${maxRetries}):`, error.message);

        if (error.message?.toLowerCase().includes('network') || error.message?.toLowerCase().includes('failed to fetch')) {
          console.warn('⚠️ Network error - will retry...');
          if (attempt < maxRetries) {
            const delay = Math.pow(2, attempt) * 2000;
            console.log(`⏳ Waiting ${delay / 1000}s before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }

        if (attempt >= maxRetries) {
          console.error('❌ AUTO-TRADE PERMANENTLY FAILED after 3 attempts');
        }
        break;
      }
    }
  };

  // Check if backend functions are available
  const [hasBackendFunctions, setHasBackendFunctions] = useState(false);
  const [lastBackendRun, setLastBackendRun] = useState(null);
  const [backendDebugLog, setBackendDebugLog] = useState(null);
  const [isRunningManualTrade, setIsRunningManualTrade] = useState(false);

  useEffect(() => {
    // Check if backend functions are available and TRIGGER them periodically
    const runBackendTrading = async () => {
      try {
        console.log('🚀 Triggering server-side trading scheduler...');
        const result = await base44.functions.invoke('tradingScheduler', {});

        if (result.data?.success) {
          setHasBackendFunctions(true);
          setLastBackendRun(new Date());
          setBackendDebugLog(result.data);
          console.log('✅ Backend trading completed:', result.data.summary);

          // Refresh portfolio data if trades were executed
          if (result.data.summary?.trades_executed > 0) {
            queryClient.invalidateQueries({ queryKey: ['portfolio'] });
            queryClient.invalidateQueries({ queryKey: ['trades'] });
          }
        } else {
          setBackendDebugLog(result.data);
        }
      } catch (error) {
        console.warn('⚠️ Backend trading not available:', error.message);
        setHasBackendFunctions(false);
      }
    };

    // Only run if auto-trading is enabled AND not forced to browser mode
    if (autoTradingSettings?.is_enabled && autoTradingSettings?.execution_mode !== 'browser') {
      // Initial run after 5 seconds
      const initialRun = setTimeout(runBackendTrading, 5000);

      // Run every 2 minutes
      const backendInterval = setInterval(runBackendTrading, 2 * 60 * 1000);

      return () => {
        clearTimeout(initialRun);
        clearInterval(backendInterval);
      };
    }
  }, [autoTradingSettings?.is_enabled, autoTradingSettings?.execution_mode]);

  // Ref to hold latest data for auto-trading interval
  const latestDataRef = useRef({
    autoTradingSettings,
    portfolio,
    assets,
    assetConfidence,
    hasBackendFunctions
  });

  useEffect(() => {
    latestDataRef.current = {
      autoTradingSettings,
      portfolio,
      assets,
      assetConfidence,
      hasBackendFunctions
    };
  }, [autoTradingSettings, portfolio, assets, assetConfidence, hasBackendFunctions]);

  useEffect(() => {
    // This effect only starts the interval if enabled. 
    // Inside the interval, we read from latestDataRef to get fresh data without resetting the interval.
    
    if (!autoTradingSettings?.is_enabled) {
      return;
    }
    
    const checkAutoTrading = async () => {
      // Use fresh data from ref
      const { 
        autoTradingSettings, 
        portfolio, 
        assets, 
        assetConfidence, 
        hasBackendFunctions 
      } = latestDataRef.current;

      if (!autoTradingSettings?.is_enabled || !portfolio || !assets || assets.length === 0) {
        console.log('⚠️ Auto-trading check skipped: Missing requirements');
        return;
      }

      if (Object.keys(assetConfidence).length === 0) {
        console.log('⏳ Auto-trading check delayed: Waiting for AI confidence data...');
        return;
      }
      
      // Determine if we should run browser-side trading
      const executionMode = autoTradingSettings.execution_mode || 'auto';
      
      // Defer ALL trade execution to the V5 server worker unless the user
      // explicitly chose browser-only mode. The browser loop previously
      // traded on synthetic (non-real) altcoin prices. The server worker
      // fetches real Binance OHLCV.
      if (executionMode !== 'browser') {
        console.log('✅ Server-side auto-trading active (V5 worker) - browser provides monitoring only');
        return;
      }

      // If execution mode is 'server' but backend is not available, warn user
      if (executionMode === 'server' && !hasBackendFunctions) {
        console.warn('⚠️ Server-only mode selected but backend functions unavailable. Auto-trading paused.');
        return;
      }

      console.log(`\n═══════════════════════════════════════════════════`);
      console.log(`🤖 AUTO-TRADING CHECK STARTED (${executionMode === 'browser' ? 'Forced Browser Mode' : 'Auto Mode'})`);
      console.log('═══════════════════════════════════════════════════');
      
      BrowserState.save({
        lastCheck: Date.now(),
        isEnabled: true,
        tradesToday: autoTradingSettings.trades_today || 0
      });

      console.log('📊 Confidence data:', Object.keys(assetConfidence).length, 'assets ready');
      console.log('💰 Available balance:', portfolio?.available_balance);
      console.log('📈 Trades today:', autoTradingSettings.trades_today, '/', autoTradingSettings.max_trades_per_day);
      console.log('⚙️ Min confidence:', autoTradingSettings.min_confidence + '%');
      
      // Combine main assets with altcoin opportunities
      const combinedAssets = [...assets];
      if (window.altcoinOpportunities && window.altcoinOpportunities.length > 0) {
        window.altcoinOpportunities.forEach(opp => {
          // Only add if not already in main assets list
          if (!combinedAssets.find(a => a.symbol === opp.symbol)) {
            combinedAssets.push({
              symbol: opp.symbol,
              name: opp.name,
              price: opp.price,
              change24h: opp.momentum,
              volume24h: opp.marketCap * 0.1, // Estimated volume
              marketCap: opp.marketCap,
              icon: opp.symbol.substring(0, 2),
              color: "bg-cyan-500"
            });
          }
        });
        console.log(`📈 Added ${window.altcoinOpportunities.length} altcoin opportunities to trading pool`);
      }

      // Combine confidence data
      const combinedConfidence = { ...assetConfidence };
      if (window.altcoinOpportunities) {
        window.altcoinOpportunities.forEach(opp => {
          combinedConfidence[opp.symbol] = opp.confidence;
        });
      }

      console.log('🔍 Scanning for opportunities...\n');
      
      try {
        const result = await executeAutoTradingCheckAdvanced(
          combinedAssets,
          combinedConfidence,
          autoTradingSettings,
          portfolio,
          async (opportunity) => {
            console.log(`🎯 Opportunity identified: ${formatOpportunityLog(opportunity)}`);

            if (autoTradingSettings.use_smart_routing) {
              console.log('🧠 Using smart order execution...');

              const smartExecutionResult = await executeSmartOrder(
                opportunity,
                autoTradingSettings,
                portfolio,
                async (enhancedOpportunity) => {
                  const { executionPrice, actualSlippage, executionStrategy } = enhancedOpportunity;

                  console.log(`💰 Executing via ${executionStrategy?.toUpperCase()} strategy`);
                  if (executionPrice) {
                    console.log(`   Price: $${executionPrice.toFixed(2)} (slippage: ${actualSlippage?.toFixed(3)}%)`);
                  }

                  await handleAutoTrade(
                    opportunity.asset,
                    opportunity.action === 'partial_sell' ? 'sell' : enhancedOpportunity.action,
                    enhancedOpportunity.quantity || opportunity.quantity,
                    opportunity.confidence,
                    opportunity.riskLevel
                  );

                  return {
                    success: true,
                    executionPrice,
                    actualSlippage,
                    strategy: executionStrategy
                  };
                }
              );

              if (smartExecutionResult.execution_type === 'twap') {
                console.log(`📅 TWAP execution: ${smartExecutionResult.orders_completed}/${smartExecutionResult.twap_schedule.totalOrders} orders completed`);
              }

              return smartExecutionResult;
            } else {
              console.log(`🚀 Executing: ${formatOpportunityLog(opportunity)}`);
              await handleAutoTrade(
                opportunity.asset,
                opportunity.action === 'partial_sell' ? 'sell' : opportunity.action,
                opportunity.quantity,
                opportunity.confidence,
                opportunity.riskLevel
              );
              return { success: true, executionStrategy: 'standard' };
            }
          },
          async (update) => {
            console.log(`📊 Position update: ${update.asset.symbol} - ${update.reason}`);

            if (portfolio?.id) {
              const updatedPositions = portfolio.positions ? portfolio.positions.map(pos => ({ ...pos })) : [];
              const assetSymbol = `${update.asset.symbol}/USDT`;
              const positionIndex = updatedPositions.findIndex(
                p => p.asset_symbol === assetSymbol
              );

              if (positionIndex >= 0) {
                const position = updatedPositions[positionIndex];

                if (update.action === 'update_trailing' && update.details) {
                  position.highest_price = update.details.highestPrice;
                  position.trailing_stop_price = update.details.trailingStopPrice;
                }

                if (update.action === 'update_breakeven' && update.details) {
                  position.breakeven_activated = true;
                }

                await updatePortfolioMutation.mutateAsync({
                  id: portfolio.id,
                  data: {
                    ...portfolio,
                    positions: updatedPositions
                  }
                });
              }
            }
          }
        );

        console.log('\n📋 RESULT:', result.reason);
        
        if (result.executed) {
          console.log('✅ ✅ ✅ TRADE EXECUTED!');
          console.log('Asset:', result.opportunity.asset.symbol);
          console.log('Action:', result.opportunity.action);
          console.log('Quantity:', result.opportunity.quantity);
          if (result.executionDetails) {
            console.log('Details:', result.executionDetails);
          }
        } else if (result.positionUpdates && result.positionUpdates.length > 0) {
          console.log(`📊 Updated ${result.positionUpdates.length} position(s)`);
        } else {
          console.log('ℹ️ Reason:', result.reason);
          if (result.circuitBreakerStatus) {
            console.log('🛡️ Circuit breaker:', result.circuitBreakerStatus);
          }
          }

          // Update System Health Monitor
          setLastScanTime(Date.now());
          if (result.executed) {
          setLastScanResult(`EXECUTED: ${result.opportunity.action.toUpperCase()} ${result.opportunity.asset.symbol}`);
          } else if (result.reason) {
          // Make the reason more user friendly
          const friendlyReasons = {
             'no_opportunities': `Scanned ${combinedAssets.length} assets - No signals met criteria`,
             'no_valid_opportunity': 'Signals found but filtered by risk/rules',
             'circuit_breaker_triggered': 'Circuit Breaker Active - Trading Halted',
             'confidence_not_ready': 'Waiting for AI Confidence Models...'
          };
          setLastScanResult(friendlyReasons[result.reason] || result.reason);
          }
          if (result.marketCondition) {
          setCurrentMarketCondition(result.marketCondition);
          }

          console.log('═══════════════════════════════════════════════════\n');
          } catch (error) {
        console.error('❌ Auto-trading check failed:', error);
      }
    };

    console.log('⏱️ Setting up auto-trading background worker (45 seconds)');
    // Run immediately once
    checkAutoTrading();
    
    // Use a Web Worker for reliable timing in background
    const workerScript = `
      self.onmessage = function(e) {
        if (e.data === 'start') {
          // Clear any existing interval
          if (self.timer) clearInterval(self.timer);
          self.timer = setInterval(() => {
            self.postMessage('tick');
          }, 45000);
        } else if (e.data === 'stop') {
          if (self.timer) clearInterval(self.timer);
        }
      };
    `;
    
    const blob = new Blob([workerScript], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    
    worker.onmessage = (e) => {
      if (e.data === 'tick') {
        checkAutoTrading();
      }
    };
    
    worker.postMessage('start');

    return () => {
      console.log('🛑 Stopping auto-trading monitor');
      worker.postMessage('stop');
      worker.terminate();
    };
  }, [autoTradingSettings?.is_enabled]); // Only restart if enabled state changes

  // Extracted auto-trading logic for manual triggering
  const runBrowserAutoTrading = async () => {
    if (!autoTradingSettings?.is_enabled || !portfolio || !assets || assets.length === 0) {
      console.log('⚠️ Manual check skipped: Missing requirements');
      return;
    }
    
    console.log('🎬 Manually triggering browser auto-trading check...');
    
    console.log('\n═══════════════════════════════════════════════════');
    console.log('🤖 BROWSER AUTO-TRADING CHECK STARTED (MANUAL)');
    console.log('═══════════════════════════════════════════════════');
    
    // Combine assets and confidence (logic duplicated from useEffect for now, ideal to refactor fully)
    const combinedAssets = [...assets];
    if (window.altcoinOpportunities && window.altcoinOpportunities.length > 0) {
      window.altcoinOpportunities.forEach(opp => {
        if (!combinedAssets.find(a => a.symbol === opp.symbol)) {
          combinedAssets.push({
            symbol: opp.symbol,
            name: opp.name,
            price: opp.price,
            change24h: opp.momentum,
            volume24h: opp.volume24h || 0,
            marketCap: opp.marketCap,
            icon: opp.symbol.substring(0, 2),
            color: "bg-cyan-500"
          });
        }
      });
    }

    const combinedConfidence = { ...assetConfidence };
    if (window.altcoinOpportunities) {
      window.altcoinOpportunities.forEach(opp => {
        combinedConfidence[opp.symbol] = opp.confidence;
      });
    }

    try {
      const result = await executeAutoTradingCheckAdvanced(
        combinedAssets,
        combinedConfidence,
        autoTradingSettings,
        portfolio,
        async (opportunity) => {
          // ... execution logic matching the useEffect one ...
          // For simplicity, calling the internal handleExecuteTrade wrapper directly if possible
          // But the smart routing logic is complex.
          // Ideally we should extract the execution callback generator too.
          
          // Re-implementing the callback logic briefly here for robustness
          console.log(`🎯 Opportunity identified: ${formatOpportunityLog(opportunity)}`);

          if (autoTradingSettings.use_smart_routing) {
            const smartExecutionResult = await executeSmartOrder(
              opportunity,
              autoTradingSettings,
              portfolio,
              async (enhancedOpportunity) => {
                await handleAutoTrade(
                  opportunity.asset,
                  opportunity.action === 'partial_sell' ? 'sell' : enhancedOpportunity.action,
                  enhancedOpportunity.quantity || opportunity.quantity,
                  opportunity.confidence,
                  opportunity.riskLevel
                );
                return { success: true, executionPrice: enhancedOpportunity.price };
              }
            );
            return smartExecutionResult;
          } else {
            await handleAutoTrade(
              opportunity.asset,
              opportunity.action === 'partial_sell' ? 'sell' : opportunity.action,
              opportunity.quantity,
              opportunity.confidence,
              opportunity.riskLevel
            );
            return { success: true };
          }
        },
        async (update) => {
           // Position update logic
           console.log(`📊 Position update: ${update.asset.symbol}`);
           // ... simplified update logic ...
           // We can assume the standard updatePortfolioMutation works
        }
      );
      
      if (result.executed) {
        console.log('✅ TRADE EXECUTED!');
        // Refresh queries
        queryClient.invalidateQueries({ queryKey: ['portfolio'] });
        queryClient.invalidateQueries({ queryKey: ['trades'] });
        queryClient.invalidateQueries({ queryKey: ['auto-trading-settings'] });
      } else {
        console.log('ℹ️ No trade executed:', result.reason);
      }
      return result;
    } catch (error) {
      console.error('Manual check failed:', error);
      throw error;
    }
  };

  const calculateAIConfidence = async () => {
    const confidence = {};
    const lastConfidenceCalc = localStorage.getItem('last_confidence_calculation');
    const MIN_TIME_BETWEEN_CALCULATIONS = 120 * 1000;

    if (lastConfidenceCalc && (Date.now() - parseInt(lastConfidenceCalc)) < MIN_TIME_BETWEEN_CALCULATIONS) {
      console.log('⏳ Rate limit: Using cached confidence data');
      if (window.assetSignalData) {
        Object.keys(window.assetSignalData).forEach(symbol => {
          confidence[symbol] = window.assetSignalData[symbol].confidence;
        });
        setAssetConfidence(confidence);
        return;
      }
    }

    // Smart asset selection for deep AI analysis
    const selectAssetsForDeepAnalysis = () => {
      let priorityAssets = [];
      
      // 1. User's watchlist (highest priority)
      const watchlist = userPreferences?.watchlist || [];
      priorityAssets = assets.filter(a => watchlist.includes(a.symbol));
      
      // 2. User's preferred assets
      const preferred = userPreferences?.preferred_assets || [];
      priorityAssets = [...priorityAssets, ...assets.filter(a => preferred.includes(a.symbol) && !priorityAssets.find(p => p.symbol === a.symbol))];
      
      // 3. Rotate through high-volume/volatile assets
      const rotationIndex = Math.floor(Date.now() / (5 * 60 * 1000)) % Math.ceil(assets.length / 10); // Rotate every 5 min
      const sortedByActivity = [...assets].sort((a, b) => {
        const scoreA = (Math.abs(a.change24h) * 2) + (a.volume24h / 1e9);
        const scoreB = (Math.abs(b.change24h) * 2) + (b.volume24h / 1e9);
        return scoreB - scoreA;
      });
      const rotatedAssets = sortedByActivity.slice(rotationIndex * 10, (rotationIndex + 1) * 10);
      priorityAssets = [...priorityAssets, ...rotatedAssets.filter(a => !priorityAssets.find(p => p.symbol === a.symbol))];
      
      // Take top 10 for deep analysis
      return priorityAssets.slice(0, 10);
      };

      const assetsForDeepAnalysis = selectAssetsForDeepAnalysis();
      console.log(`🎯 Deep AI analysis for: ${assetsForDeepAnalysis.map(a => a.symbol).join(', ')}`);

      // Process priority assets with advanced AI
      for (const asset of assetsForDeepAnalysis) {
      try {
        const advancedSignal = await generateAdvancedSignal(asset, null, indicatorSettings);
        confidence[asset.symbol] = advancedSignal.confidence;

        if (!window.assetSignalData) window.assetSignalData = {};
        window.assetSignalData[asset.symbol] = {
          ...advancedSignal,
          timestamp: Date.now()
        };
      } catch (error) {
        console.error(`Failed to generate signal for ${asset.symbol}:`, error);
        confidence[asset.symbol] = calculateBasicConfidence(asset);
        if (!window.assetSignalData) window.assetSignalData = {};
        window.assetSignalData[asset.symbol] = {
          confidence: confidence[asset.symbol],
          recommendation: confidence[asset.symbol] > 70 ? 'buy' : confidence[asset.symbol] < 40 ? 'sell' : 'hold',
          timestamp: Date.now()
        };
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Process remaining assets with basic confidence
    const deepAnalysisSymbols = new Set(assetsForDeepAnalysis.map(a => a.symbol));
    const excluded = userPreferences?.excluded_assets || [];
    
    for (const asset of assets) {
      if (deepAnalysisSymbols.has(asset.symbol)) continue;
      if (excluded.includes(asset.symbol)) continue; // Skip excluded assets
      
      confidence[asset.symbol] = calculateBasicConfidence(asset);
      if (!window.assetSignalData) window.assetSignalData = {};
      window.assetSignalData[asset.symbol] = {
        confidence: confidence[asset.symbol],
        recommendation: confidence[asset.symbol] > 70 ? 'buy' : confidence[asset.symbol] < 40 ? 'sell' : 'hold',
        timestamp: Date.now()
      };
    }

    localStorage.setItem('last_confidence_calculation', Date.now().toString());
    setAssetConfidence(confidence);
  };

  const calculateBasicConfidence = (asset) => {
    // Deterministic score from REAL Binance 24h change & quote volume.
    // No random noise, no market cap (Binance doesn't provide it).
    let score = 60;
    const change = asset.change24h || 0;

    if (change > 2 && change <= 10) score += 15; // Sweet spot
    else if (change > 10) score += 5;            // Overextended
    else if (change > 0) score += 10;           // Grind up
    else if (change > -3) score += 5;            // Dip/Consolidation
    else if (change > -8) score -= 5;           // Moderate correction
    else score -= 20;                            // Crash

    const avgVolume = 1500000000;
    const vol = asset.volume24h || 0;
    if (vol > avgVolume * 2) score += 10;
    else if (vol > avgVolume) score += 5;
    else if (vol < avgVolume / 2) score -= 5;

    const volatility = Math.abs(change);
    if (volatility > 10) score -= 5;
    else if (volatility < 2) score += 5;

    return Math.max(30, Math.min(95, Math.round(score)));
  };

  const fetchLivePrices = async () => {
    if (consecutiveFailures >= 3) {
      console.log('⚠️ Skipping price fetch due to repeated failures. Using cached prices.');
      return;
    }

    setIsPriceLoading(true);
    setPriceUpdateError(null);

    try {
      // OKX spot tickers — one request for ALL USDT pairs, filtered client-side.
      // OKX is reachable from the UK (Binance REST API is geo-blocked).
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch('https://www.okx.com/api/v5/market/tickers?instType=SPOT', {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`OKX API returned ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      if (!data || !Array.isArray(data.data)) {
        throw new Error('Invalid data format received from OKX');
      }

      const tickerBySymbol = {};
      data.data.forEach(t => {
        if (typeof t.instId === 'string' && t.instId.endsWith('-USDT')) {
          tickerBySymbol[t.instId.replace(/-USDT$/, '')] = t;
        }
      });

      const updatedAssets = initialAssets.map(asset => {
        const t = tickerBySymbol[asset.symbol];
        if (t) {
          const last = parseFloat(t.last);
          const open24h = parseFloat(t.open24h);
          const change24h = open24h > 0 ? ((last - open24h) / open24h) * 100 : asset.change24h;
          return {
            ...asset,
            price: last || asset.price,
            change24h: change24h || asset.change24h,
            volume24h: parseFloat(t.volCcy24h) || asset.volume24h
          };
        }
        return asset;
      });

      setAssets(updatedAssets);
      setLastPriceUpdate(new Date());
      setConsecutiveFailures(0);
      setPriceUpdateError(null);

      console.log('✅ Price data updated from OKX spot tickers');
    } catch (error) {
      const errorMessage = error.name === 'AbortError'
        ? 'Request timeout - OKX took too long to respond'
        : error.message || 'Unknown error';

      console.warn('⚠️ Failed to fetch OKX prices:', errorMessage);
      setPriceUpdateError(errorMessage);
      setConsecutiveFailures(prev => prev + 1);

      console.log('ℹ️ Continuing with WebSocket price data');

      if (assets.length === 0) {
        setAssets(initialAssets);
      }
    } finally {
      setIsPriceLoading(false);
    }
  };

  const handleResetPortfolio = async () => {
    if (window.confirm('Are you sure you want to reset your paper trading portfolio? This will clear all trades and reset your balance to $10,000.')) {
      await resetPortfolioMutation.mutateAsync();
    }
  };

  const handleTrade = (asset, type) => {
    setSelectedAsset(asset);
    setTradeType(type);
    setIsTradeModalOpen(true);
  };

  const handleAnalyze = (asset) => {
    setAnalysisAsset(asset);
    setIsAnalysisModalOpen(true);
  };

  const handleClosePosition = async (position) => {
    if (!portfolio) {
      console.error('No portfolio found');
      return;
    }

    try {
      console.log('Closing position:', position);
      const assetSymbol = position.asset_symbol.replace('/USDT', '');
      let asset = assets.find(a => a.symbol === assetSymbol);

      // If asset not in current list, create a minimal asset object using position data
      if (!asset) {
        console.warn(`Asset ${assetSymbol} not in trading list, using position data to close`);
        const currentPrice = position.current_value / position.quantity; // Calculate from position
        asset = {
          symbol: assetSymbol,
          name: assetSymbol,
          price: currentPrice,
          icon: assetSymbol.charAt(0),
          color: "bg-slate-500"
        };
      }

      console.log('Executing sell trade for:', assetSymbol, 'quantity:', position.quantity, 'price:', asset.price);

      await handleExecuteTrade({
        asset: asset,
        tradeType: 'sell',
        quantity: position.quantity,
        price: asset.price,
        totalValue: position.quantity * asset.price
      });

      console.log(`✅ Position closed: ${position.asset_symbol}`);
    } catch (error) {
      console.error('Failed to close position:', error);
      alert(`Failed to close position: ${error.message || 'Unknown error'}`);
    }
  };

  const handleApplyAdvisorRecommendation = async (recommendation) => {
    if (!autoTradingSettings?.id) {
      alert('Auto-trading settings not found');
      return;
    }

    try {
      const updatedSettings = { ...autoTradingSettings };

      if (recommendation.parameter === 'use_trailing_stop' ||
        recommendation.parameter === 'use_breakeven_protection') {
        updatedSettings[recommendation.parameter] = recommendation.suggested_value === 1;
      } else if (recommendation.parameter === 'allowed_risk_levels') {
        updatedSettings[recommendation.parameter] = recommendation.suggested_value === 1
          ? ['low']
          : ['low', 'medium'];
      } else {
        updatedSettings[recommendation.parameter] = recommendation.suggested_value;
      }

      await base44.entities.AutoTradingSettings.update(autoTradingSettings.id, updatedSettings);
      queryClient.invalidateQueries({ queryKey: ['auto-trading-settings'] });

      alert(`Successfully updated ${recommendation.parameter.replace(/_/g, ' ')}`);
    } catch (error) {
      console.error('Failed to apply recommendation:', error);
      alert('Failed to apply recommendation');
    }
  };

  const sortedAndFilteredAssets = assets
    .filter(asset =>
      asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.symbol.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .map(asset => ({
      ...asset,
      confidence: assetConfidence[asset.symbol] || 50,
      recommendation: window.assetSignalData?.[asset.symbol]?.recommendation || 'hold'
    }))
    .filter(asset => {
      if (signalFilter === "all") return true;
      return asset.recommendation === signalFilter;
    })
    .sort((a, b) => {
      const signalOrder = { buy: 3, hold: 2, sell: 1 };
      switch (sortBy) {
        case "confidence":
          return b.confidence - a.confidence;
        case "signal":
          return signalOrder[b.recommendation] - signalOrder[a.recommendation];
        case "price":
          return b.price - a.price;
        case "change":
          return Math.abs(b.change24h) - Math.abs(a.change24h);
        default:
          return b.confidence - a.confidence;
      }
    });

  const totalProfit = trades.reduce((sum, trade) => sum + ((trade.profit_loss || 0)), 0);

  // Combine standard assets with altcoin opportunities to ensure PortfolioCard has prices for all positions
  const allAssets = React.useMemo(() => {
    const combined = [...assets];
    if (altcoinOpportunities && altcoinOpportunities.length > 0) {
      altcoinOpportunities.forEach(opp => {
        // Only add if not already in main assets list to prevent duplicates
        if (!combined.find(a => a.symbol === opp.symbol)) {
          combined.push({
            symbol: opp.symbol,
            name: opp.name,
            price: opp.price || 0,
            change24h: opp.momentum || 0,
            volume24h: 0,
            marketCap: opp.marketCap || 0,
            icon: opp.symbol ? opp.symbol.substring(0, 1) : "?",
            color: "bg-slate-500"
          });
        }
      });
    }
    return combined;
  }, [assets, altcoinOpportunities]);

  const signalCounts = {
    buy: assets.filter(a => window.assetSignalData?.[a.symbol]?.recommendation === 'buy').length,
    sell: assets.filter(a => window.assetSignalData?.[a.symbol]?.recommendation === 'sell').length,
    hold: assets.filter(a => window.assetSignalData?.[a.symbol]?.recommendation === 'hold').length
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
          <div>
            <div className="flex items-center gap-4 mb-2">
              <h1 className="text-4xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                Indicator-Led Trading
              </h1>
              <div className="flex items-center gap-2 px-4 py-2 bg-slate-800/50 rounded-xl border border-slate-700">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                <span className="text-slate-300 text-sm font-mono">
                  {currentTime.toLocaleTimeString()}
                </span>
              </div>
            </div>
            <p className="text-slate-400">Trade top 20 cryptocurrencies with indicator-led signals on real Binance data</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => setShowNewsWidget(!showNewsWidget)}
              size="lg"
              className={`${showNewsWidget ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-700 hover:bg-slate-600'} text-white font-bold`}
            >
              <Newspaper className="w-5 h-5 mr-2" />
              News Feed
            </Button>
            <div className="flex gap-1">
              <Button
                onClick={() => setShowRecommendations(true)}
                size="lg"
                className="bg-gradient-to-br from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold rounded-r-none border-r border-white/20"
              >
                <Sparkles className="w-5 h-5 mr-2" />
                AI Signals
              </Button>
              <Button
                onClick={() => setShowIndicatorSettings(true)}
                size="lg"
                className="bg-gradient-to-br from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold rounded-l-none px-3"
                title="Configure Indicators"
              >
                <Settings className="w-5 h-5" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setShowAltcoinScanner(true)}
                size="lg"
                disabled={!altcoinScannerEnabled}
                className={`font-bold ${altcoinScannerEnabled ? "bg-gradient-to-br from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white" : "bg-slate-700 text-slate-500 cursor-not-allowed"}`}
              >
                <Scan className="w-5 h-5 mr-2" />
                Altcoin Scanner
              </Button>
              <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/50 rounded-xl border border-slate-700">
                <Switch
                  checked={altcoinScannerEnabled}
                  onCheckedChange={toggleAltcoinScanner}
                />
                <span className="text-xs text-slate-400 font-medium">
                  {altcoinScannerEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>
            </div>
            <ConfluenceSignalScanner assets={assets} indicatorSettings={indicatorSettings} />
            <Button
              onClick={() => setShowWatchlistModal(true)}
              size="lg"
              className="bg-gradient-to-br from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold"
            >
              <TrendingUp className="w-5 h-5 mr-2" />
              My Watchlist
            </Button>
          </div>
        </div>

        {autoTradingSettings?.is_enabled && (
          <>
            <div className="mb-6">
          <SystemHealthMonitor 
            autoTradingSettings={autoTradingSettings}
            lastScanTime={lastScanTime}
            lastScanResult={lastScanResult}
            activeAssetsCount={Object.keys(assetConfidence).length}
            marketCondition={currentMarketCondition}
          />
        </div>

        <div className="bg-gradient-to-r from-slate-800 via-slate-900 to-slate-800 border-2 border-green-500/40 rounded-2xl p-4 mb-6">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-gradient-to-br from-green-600 to-emerald-600 rounded-xl flex items-center justify-center relative shadow-lg">
                    <Sparkles className="w-6 h-6 text-white" />
                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full animate-ping"></div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className="bg-gradient-to-r from-green-600 to-emerald-600 text-white font-bold shadow-md">
                        AUTO-TRADING ACTIVE
                      </Badge>
                      {hasBackendFunctions ? (
                        <Badge className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold shadow-md">
                          ⚡ 24/7 Server-Side Mode
                        </Badge>
                      ) : (
                        <>
                          <Badge className="bg-slate-700 border-green-500/50 text-green-400 font-semibold">
                            Browser-Assisted Mode
                          </Badge>
                          {!isPageVisible && (
                            <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 animate-pulse">
                              <EyeOff className="w-3 h-3 mr-1" />
                              Tab Hidden
                            </Badge>
                          )}
                        </>
                      )}
                    </div>
                    <p className="text-slate-300 text-sm">
                      {hasBackendFunctions 
                        ? '🚀 Trading 24/7 on server - no browser required • '
                        : 'AI is monitoring markets and executing trades automatically • '
                      }
                      {autoTradingSettings.trades_today || 0}/{autoTradingSettings.max_trades_per_day || 10} trades today
                      {((autoTradingSettings.daily_loss || 0) >= (autoTradingSettings.max_daily_loss_percent || 0)) && (
                        <span className="ml-2 text-red-400 font-bold">⚠️ CIRCUIT BREAKER TRIGGERED</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={async () => {
                      setIsRunningManualTrade(true);
                      try {
                        const result = await base44.functions.invoke('tradingScheduler', {});
                        setBackendDebugLog(result.data);
                        if (result.data?.summary?.trades_executed > 0) {
                          queryClient.invalidateQueries({ queryKey: ['portfolio'] });
                          queryClient.invalidateQueries({ queryKey: ['trades'] });
                        }
                        alert(`Trade check complete!\n\nUsers processed: ${result.data?.summary?.users_processed || 0}\nTrades executed: ${result.data?.summary?.trades_executed || 0}\nErrors: ${result.data?.summary?.errors || 0}`);
                      } catch (err) {
                        alert('Error: ' + err.message);
                      }
                      setIsRunningManualTrade(false);
                    }}
                    disabled={isRunningManualTrade}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white"
                    size="sm"
                  >
                    {isRunningManualTrade ? (
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4 mr-2" />
                    )}
                    Run Trade Check Now
                  </Button>
                  <Button
                    onClick={() => window.location.href = '/AutoTrading'}
                    variant="outline"
                    className="border-green-500/50 bg-slate-800 text-green-400 hover:bg-green-500/10 hover:border-green-500"
                    size="sm"
                  >
                    <Settings className="w-4 h-4 mr-2" />
                    Manage Settings
                  </Button>
                </div>
              </div>

              {backendDebugLog && (
                <div className="mt-4 p-3 bg-slate-900 rounded-lg border border-slate-700">
                  <p className="text-xs text-slate-400 mb-1">Last Backend Result:</p>
                  <pre className="text-xs text-green-400 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(backendDebugLog, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </>
        )}

        {showVisibilityWarning && !isPageVisible && autoTradingSettings?.is_enabled && (
          <div className="bg-indigo-500/10 border-2 border-indigo-500/50 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <EyeOff className="w-6 h-6 text-indigo-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-indigo-300 font-semibold mb-1">Running in Background</h4>
                <p className="text-indigo-200 text-sm mb-3">
                  Background worker active. Auto-trading checks will continue every 45s even while minimized.
                </p>
                <Button
                  onClick={() => setShowVisibilityWarning(false)}
                  variant="outline"
                  size="sm"
                  className="border-orange-500/50 text-orange-400 hover:bg-orange-500/10"
                >
                  Got it
                </Button>
              </div>
            </div>
          </div>
        )}

        <BackendMigrationGuide isActive={hasBackendFunctions} />

        <AutoTradingDebugPanel
          autoTradingSettings={autoTradingSettings}
          portfolio={portfolio}
          assets={assets}
          assetConfidence={assetConfidence}
          isEnabled={autoTradingSettings?.is_enabled || false}
          onManualCheck={runBrowserAutoTrading}
        />

        {priceUpdateError && consecutiveFailures < 3 && (
          <div className="bg-orange-500/10 border-2 border-orange-500/50 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-orange-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-orange-300 font-semibold mb-1">Price Update Warning</h4>
                <p className="text-orange-200 text-sm mb-2">
                  Unable to fetch live prices: {priceUpdateError}
                </p>
                <p className="text-orange-200 text-sm">
                  Using cached prices. Attempt {consecutiveFailures}/3
                </p>
              </div>
              <Button
                onClick={() => {
                  setConsecutiveFailures(0);
                  fetchLivePrices();
                }}
                variant="outline"
                size="sm"
                className="border-orange-500/50 text-orange-400 hover:bg-orange-500/10"
              >
                Retry Now
              </Button>
            </div>
          </div>
        )}

        {consecutiveFailures >= 3 && (
          <div className="bg-red-500/10 border-2 border-red-500/50 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-red-300 font-semibold mb-1">Live Prices Unavailable</h4>
                <p className="text-red-200 text-sm mb-2">
                  Multiple attempts to fetch live prices failed. Using simulated data.
                </p>
                <p className="text-red-200 text-sm text-xs">
                  This may be due to OKX API rate limits, CORS restrictions, or network issues.
                  Trading functionality continues with cached prices.
                </p>
              </div>
              <Button
                onClick={() => {
                  setConsecutiveFailures(0);
                  setPriceUpdateError(null);
                  fetchLivePrices();
                }}
                variant="outline"
                size="sm"
                className="border-red-500/50 text-red-400 hover:bg-red-500/10"
              >
                Reset & Retry
              </Button>
            </div>
          </div>
        )}

        <div className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-2 border-yellow-500/50 rounded-2xl p-4 mb-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-yellow-500 rounded-xl flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge className="bg-yellow-500 text-black font-bold">PAPER TRADING MODE</Badge>
                  <Badge variant="outline" className="border-yellow-500 text-yellow-500">
                    Live Prices • Virtual $10,000
                  </Badge>
                  {isWsConnected && (
                    <Badge className="bg-green-500/20 text-green-400 border-green-500/50 animate-pulse">
                      ⚡ WebSocket Connected
                    </Badge>
                  )}
                </div>
                <p className="text-yellow-200 text-sm">
                  Trading with simulated funds and real-time market data. <strong>No real money at risk.</strong>
                  {lastPriceUpdate && !isWsConnected && (
                    <span className="ml-2 text-yellow-300/70">
                      • Last Poll {lastPriceUpdate.toLocaleTimeString()}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={fetchLivePrices}
                disabled={isPriceLoading}
                className="bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-bold border-none shadow-lg hover:shadow-yellow-500/20 transition-all"
                size="sm"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isPriceLoading ? 'animate-spin' : ''}`} />
                Refresh Prices
              </Button>
              <Button
                onClick={handleResetPortfolio}
                className="bg-red-500 hover:bg-red-600 text-white font-bold border-none shadow-lg hover:shadow-red-500/20 transition-all"
                size="sm"
                disabled={resetPortfolioMutation.isPending}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Reset Portfolio
              </Button>
            </div>
          </div>
        </div>

        <div className="mb-8">
          <PortfolioCard
            portfolio={portfolio}
            onClosePosition={handleClosePosition}
            assets={allAssets}
            livePrices={livePrices}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {trades && trades.length >= 5 && (
            <AITradingAdvisor
              trades={trades}
              portfolio={portfolio}
              autoTradingSettings={autoTradingSettings}
              onApplyRecommendation={handleApplyAdvisorRecommendation}
            />
          )}
          <SignalAlertSettings />
        </div>

        {showNewsWidget && (
          <div className="mb-8">
            <NewsWidget
              assets={assets}
              onNewsAlert={(news) => {
                console.log('High-impact news detected:', news);
              }}
            />
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 mb-8">
          <div className="lg:col-span-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
              <Input
                placeholder="Search cryptocurrencies..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-slate-800 border-slate-700 text-white"
              />
            </div>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl p-3">
            <label htmlFor="signal-filter" className="text-slate-400 text-xs mb-1 block">Filter by Signal</label>
            <select
              id="signal-filter"
              value={signalFilter}
              onChange={(e) => setSignalFilter(e.target.value)}
              className="w-full bg-slate-900 text-white border-none rounded text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Signals ({assets.length})</option>
              <option value="buy">🟢 Buy ({signalCounts.buy})</option>
              <option value="sell">🔴 Sell ({signalCounts.sell})</option>
              <option value="hold">🟡 Hold ({signalCounts.hold})</option>
            </select>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl p-3">
            <label htmlFor="sort-by" className="text-slate-400 text-xs mb-1 block">Sort By</label>
            <select
              id="sort-by"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full bg-slate-900 text-white border-none rounded text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="confidence">AI Confidence</option>
              <option value="signal">AI Signal</option>
              <option value="price">Price (High to Low)</option>
              <option value="change">24h Change</option>
            </select>
          </div>

          <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-green-400" />
              <span className="text-slate-400 text-xs">Session P&L</span>
            </div>
            <div className={`text-xl font-bold ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totalProfit >= 0 ? '+' : ''}${totalProfit.toLocaleString()}
            </div>
          </div>

          <div className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/30 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <span className="text-slate-400 text-xs">Avg Confidence</span>
            </div>
            <div className="text-xl font-bold text-indigo-400">
              {Object.keys(assetConfidence).length > 0
                ? Math.round(Object.values(assetConfidence).reduce((a, b) => a + b, 0) / Object.values(assetConfidence).length)
                : 0}%
            </div>
          </div>
        </div>

        {signalFilter !== "all" && (
          <div className="mb-4 flex items-center gap-2">
            <Badge className={`
              ${signalFilter === 'buy' ? 'bg-green-500/20 text-green-400 border-green-500/40' : ''}
              ${signalFilter === 'sell' ? 'bg-red-500/20 text-red-400 border-red-500/40' : ''}
              ${signalFilter === 'hold' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40' : ''}
            `}>
              Showing {sortedAndFilteredAssets.length} {signalFilter.toUpperCase()} signals
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSignalFilter("all")}
              className="text-slate-400 hover:text-white"
            >
              Clear Filter
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {sortedAndFilteredAssets.map((asset, index) => (
            <AssetCard
              key={asset.symbol}
              asset={asset}
              rank={index + 1}
              onTrade={handleTrade}
              onAnalyze={handleAnalyze}
            />
          ))}
        </div>

        {sortedAndFilteredAssets.length === 0 && (
          <div className="text-center py-12">
            <p className="text-slate-400">
              {searchQuery
                ? `No assets found matching "${searchQuery}"`
                : `No ${signalFilter.toUpperCase()} signals found`}
            </p>
          </div>
        )}
      </div>

      {activeToast && (
        <NotificationToast
          notification={activeToast}
          onClose={clearToast}
          onAction={() => {
            clearToast();
          }}
        />
      )}

      {showRecommendations && (
        <AIRecommendationNotification
          assets={assets}
          onTradeAsset={handleTrade}
          onExecuteTrade={handleExecuteTrade}
          portfolio={portfolio}
          autoTradingSettings={autoTradingSettings}
          onClose={() => setShowRecommendations(false)}
        />
      )}

      {showAltcoinScanner && (
        <AltcoinScannerModal
          onTradeAsset={handleTrade}
          onClose={() => setShowAltcoinScanner(false)}
        />
      )}

      {showWatchlistModal && (
        <WatchlistModal
          assets={assets}
          userPreferences={userPreferences}
          onClose={() => {
            setShowWatchlistModal(false);
            queryClient.invalidateQueries({ queryKey: ['trading-preferences'] });
          }}
        />
      )}

      {showIndicatorSettings && (
        <IndicatorSettingsModal
          isOpen={showIndicatorSettings}
          onClose={() => setShowIndicatorSettings(false)}
          settings={indicatorSettings}
          onUpdate={setIndicatorSettings}
        />
      )}

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

      {analysisAsset && (
        <AIAnalysisModal
          isOpen={isAnalysisModalOpen}
          onClose={() => setIsAnalysisModalOpen(false)}
          asset={analysisAsset}
        />
      )}
    </div>
  );
}