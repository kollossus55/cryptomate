import { Badge } from "@/components/ui/badge";
import { Newspaper, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { motion } from "framer-motion";

export default function NewsSentimentIndicator({ asset, sentiment, score, impact, showDetails = false }) {
  if (!sentiment || score === undefined) return null;

  const getSentimentConfig = (sent) => {
    const configs = {
      'very_bullish': {
        color: 'text-green-400 bg-green-500/20 border-green-500/50',
        icon: TrendingUp,
        label: '🚀 Very Bullish',
        shortLabel: '🚀'
      },
      'bullish': {
        color: 'text-green-400 bg-green-500/10 border-green-500/30',
        icon: TrendingUp,
        label: '📈 Bullish',
        shortLabel: '📈'
      },
      'neutral': {
        color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
        icon: Minus,
        label: '➡️ Neutral',
        shortLabel: '➡️'
      },
      'bearish': {
        color: 'text-red-400 bg-red-500/10 border-red-500/30',
        icon: TrendingDown,
        label: '📉 Bearish',
        shortLabel: '📉'
      },
      'very_bearish': {
        color: 'text-red-400 bg-red-500/20 border-red-500/50',
        icon: TrendingDown,
        label: '🔻 Very Bearish',
        shortLabel: '🔻'
      }
    };
    return configs[sent] || configs.neutral;
  };

  const config = getSentimentConfig(sentiment);
  const Icon = config.icon;
  const scorePercent = Math.round(Math.abs(score) * 100);

  if (!showDetails) {
    return (
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="inline-flex items-center"
      >
        <Badge className={`${config.color} border font-semibold px-2 py-1 text-xs flex items-center gap-1`}>
          <Newspaper className="w-3 h-3" />
          {config.shortLabel} {scorePercent}%
        </Badge>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`${config.color} border-2 rounded-lg p-3`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Newspaper className="w-4 h-4" />
          <span className="font-bold text-sm">News Sentiment</span>
        </div>
        {impact === 'high' && (
          <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/40 text-xs animate-pulse">
            HIGH IMPACT
          </Badge>
        )}
      </div>
      
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-5 h-5" />
        <span className="font-bold">{config.label}</span>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span>Sentiment Score:</span>
        <span className="font-bold">
          {score > 0 ? '+' : ''}{scorePercent}%
        </span>
      </div>

      {/* Sentiment Bar */}
      <div className="mt-2 h-2 bg-slate-800 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${scorePercent}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className={`h-full ${score > 0 ? 'bg-green-500' : 'bg-red-500'}`}
        />
      </div>
    </motion.div>
  );
}