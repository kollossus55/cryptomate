import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, TrendingUp, TrendingDown, CheckCircle2, XCircle, Wifi, Sparkles, AlertTriangle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function NotificationToast({ notification, onClose, onAction }) {
  useEffect(() => {
    // Auto-close after 10 seconds for non-urgent notifications
    if (notification.priority !== 'urgent') {
      const timer = setTimeout(() => {
        onClose();
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [notification, onClose]);

  const getIcon = () => {
    const iconProps = { className: "w-6 h-6" };
    
    switch (notification.notification_type) {
      case 'price_alert':
        return notification.priority === 'high' || notification.priority === 'urgent'
          ? <TrendingUp {...iconProps} className="w-6 h-6 text-green-400" />
          : <TrendingDown {...iconProps} className="w-6 h-6 text-red-400" />;
      case 'order_filled':
        return <CheckCircle2 {...iconProps} className="w-6 h-6 text-green-400" />;
      case 'order_cancelled':
        return <XCircle {...iconProps} className="w-6 h-6 text-red-400" />;
      case 'connection_status':
        return <Wifi {...iconProps} className="w-6 h-6 text-blue-400" />;
      case 'ai_anomaly':
        return <Sparkles {...iconProps} className="w-6 h-6 text-purple-400" />;
      default:
        return <AlertTriangle {...iconProps} className="w-6 h-6 text-yellow-400" />;
    }
  };

  const getBackgroundClass = () => {
    switch (notification.priority) {
      case 'urgent':
        return 'bg-gradient-to-r from-red-900/90 to-orange-900/90 border-red-500/50';
      case 'high':
        return 'bg-gradient-to-r from-orange-900/90 to-yellow-900/90 border-orange-500/50';
      case 'medium':
        return 'bg-gradient-to-r from-indigo-900/90 to-purple-900/90 border-indigo-500/50';
      default:
        return 'bg-gradient-to-r from-slate-900/90 to-slate-800/90 border-slate-700/50';
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -50, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -50, scale: 0.9 }}
        className={`fixed top-4 right-4 z-[100] w-full max-w-md ${getBackgroundClass()} backdrop-blur-lg border rounded-2xl shadow-2xl overflow-hidden flex flex-col`}
        style={{ maxHeight: '85vh' }}
      >
        <ScrollArea className="flex-1" style={{ maxHeight: 'calc(85vh - 4px)' }}>
          <div className="p-4">
            <div className="flex gap-3">
              <div className="flex-shrink-0 mt-1">
                {getIcon()}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h4 className="font-bold text-white text-base">
                    {notification.title}
                  </h4>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {notification.priority === 'urgent' && (
                      <motion.div
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ repeat: Infinity, duration: 1.5 }}
                      >
                        <Badge className="bg-red-500 text-white border-red-600 font-bold">
                          URGENT
                        </Badge>
                      </motion.div>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-white/70 hover:text-white hover:bg-white/10 flex-shrink-0"
                      onClick={onClose}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                
                <p className="text-sm text-slate-200 mb-3">
                  {notification.message}
                </p>
                
                {notification.data && (
                  <div className="bg-black/20 rounded-lg p-3 mb-3 space-y-1 text-sm">
                    {notification.data.asset && (
                      <div className="flex justify-between">
                        <span className="text-slate-300">Asset:</span>
                        <span className="text-white font-bold">{notification.data.asset}</span>
                      </div>
                    )}
                    {notification.data.price !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-slate-300">Price:</span>
                        <span className="text-white font-bold">${notification.data.price.toLocaleString()}</span>
                      </div>
                    )}
                    {notification.data.change !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-slate-300">Change:</span>
                        <span className={`font-bold ${notification.data.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {notification.data.change >= 0 ? '+' : ''}{notification.data.change.toFixed(2)}%
                        </span>
                      </div>
                    )}
                    {notification.data.threshold && (
                      <div className="flex justify-between">
                        <span className="text-slate-300">Threshold:</span>
                        <span className="text-white font-bold">${notification.data.threshold.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                )}
                
                {notification.action_url && (
                  <Button
                    size="sm"
                    onClick={onAction}
                    className="w-full bg-white/10 hover:bg-white/20 text-white border border-white/20"
                  >
                    View Details
                  </Button>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>
        
        {/* Progress bar for auto-close */}
        {notification.priority !== 'urgent' && (
          <motion.div
            initial={{ width: '100%' }}
            animate={{ width: '0%' }}
            transition={{ duration: 10, ease: 'linear' }}
            className="h-1 bg-white/30"
          />
        )}
      </motion.div>
    </AnimatePresence>
  );
}