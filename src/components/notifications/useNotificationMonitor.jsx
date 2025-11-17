/**
 * Custom hook for monitoring and triggering notifications
 * This simulates what backend functions would do automatically
 */
import { useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';

export function useNotificationMonitor(assets = []) {
  const [activeToast, setActiveToast] = useState(null);
  const lastCheckTime = useRef(Date.now());
  const priceHistory = useRef({});

  const { data: alerts = [] } = useQuery({
    queryKey: ['price-alerts'],
    queryFn: () => base44.entities.PriceAlert.list(),
    refetchInterval: 120000, // INCREASED: Refresh every 2 minutes (was 30s)
    retry: 1, // REDUCED: Only retry once
    retryDelay: 5000, // Wait 5s before retry
    staleTime: 60000, // Consider data fresh for 1 minute
  });

  const { data: connections = [] } = useQuery({
    queryKey: ['exchange-connections'],
    queryFn: () => base44.entities.ExchangeConnection.list(),
    refetchInterval: 300000, // INCREASED: Refresh every 5 minutes (was 60s)
    retry: 1,
    retryDelay: 5000,
    staleTime: 120000, // Consider data fresh for 2 minutes
  });

  // Monitor price alerts - REDUCED FREQUENCY
  useEffect(() => {
    if (!assets || assets.length === 0 || !alerts || alerts.length === 0) return;

    const checkPriceAlerts = async () => {
      const activeAlerts = alerts.filter(a => a.is_active);
      
      // Process maximum 3 alerts per check to reduce load
      const alertsToCheck = activeAlerts.slice(0, 3);
      
      for (const alert of alertsToCheck) {
        try {
          const asset = assets.find(a => 
            a.symbol === alert.asset_symbol || 
            `${a.symbol}/USDT` === alert.asset_symbol ||
            a.symbol === alert.asset_symbol.replace('/USDT', '')
          );
          
          if (!asset) continue;

          const currentPrice = asset.price;
          const threshold = alert.threshold_value;
          let shouldTrigger = false;
          let message = '';

          switch (alert.alert_type) {
            case 'price_above':
              if (currentPrice > threshold) {
                shouldTrigger = true;
                message = `${alert.asset_symbol} price ($${currentPrice.toLocaleString()}) is above your alert threshold of $${threshold.toLocaleString()}`;
              }
              break;
            
            case 'price_below':
              if (currentPrice < threshold) {
                shouldTrigger = true;
                message = `${alert.asset_symbol} price ($${currentPrice.toLocaleString()}) is below your alert threshold of $${threshold.toLocaleString()}`;
              }
              break;
            
            case 'price_change_percent':
              const prevPrice = priceHistory.current[alert.asset_symbol];
              if (prevPrice) {
                const changePercent = ((currentPrice - prevPrice) / prevPrice) * 100;
                if (Math.abs(changePercent) >= threshold) {
                  shouldTrigger = true;
                  message = `${alert.asset_symbol} price changed by ${changePercent.toFixed(2)}% (threshold: ${threshold}%)`;
                }
              }
              break;
            
            case 'volume_spike':
              // Very low frequency check
              if (Math.random() > 0.995) {
                shouldTrigger = true;
                message = `Unusual volume spike detected for ${alert.asset_symbol}`;
              }
              break;
            
            case 'volatility':
              // Very low frequency check
              if (Math.random() > 0.99) {
                shouldTrigger = true;
                message = `High volatility detected for ${alert.asset_symbol}`;
              }
              break;
          }

          priceHistory.current[alert.asset_symbol] = currentPrice;

          if (shouldTrigger) {
            const notification = {
              notification_type: 'price_alert',
              priority: threshold > 50 ? 'urgent' : 'high',
              title: `Price Alert: ${alert.asset_symbol}`,
              message: message,
              data: {
                asset: alert.asset_symbol,
                price: currentPrice,
                threshold: threshold,
                alert_type: alert.alert_type
              }
            };

            try {
              // Create notification with error handling
              await base44.entities.Notification.create(notification);
              setActiveToast(notification);
              
              // Update alert - only if trigger_once
              if (alert.trigger_once) {
                await base44.entities.PriceAlert.update(alert.id, {
                  ...alert,
                  triggered_count: (alert.triggered_count || 0) + 1,
                  last_triggered: new Date().toISOString(),
                  is_active: false
                });
              }
            } catch (error) {
              console.warn('⚠️ Failed to process alert:', error.message);
              // Don't retry - just log and continue
            }
          }
        } catch (alertError) {
          console.error('Error processing alert:', alertError);
        }
      }
    };

    // INCREASED: Check alerts every 2 minutes (was 60s)
    const interval = setInterval(checkPriceAlerts, 120000);
    checkPriceAlerts();

    return () => clearInterval(interval);
  }, [assets, alerts]);

  // DISABLED: Connection status monitoring to reduce API calls
  // This feature can be re-enabled when backend functions are available

  // DISABLED: AI Anomaly Detection to reduce API calls
  // This feature can be re-enabled when backend functions are available

  // News-Based Alerts - REDUCED FREQUENCY
  useEffect(() => {
    if (!assets || assets.length === 0) return;

    const checkNewsAlerts = async () => {
      // Only check first 3 assets to reduce load
      const assetsToCheck = assets.slice(0, 3);
      
      for (const asset of assetsToCheck) {
        const signalData = window.assetSignalData?.[asset.symbol];
        if (!signalData?.breakdown?.news) continue;

        const newsData = signalData.breakdown.news;
        
        if (newsData.impact_level === 'high' && Math.abs(newsData.sentiment_score) > 0.5) {
          const cacheKey = `news_alert_${asset.symbol}_${newsData.sentiment_label}`;
          if (window[cacheKey] && (Date.now() - window[cacheKey] < 600000)) {
            continue; // Skip if alerted in last 10 minutes
          }

          const notification = {
            notification_type: 'ai_anomaly',
            priority: Math.abs(newsData.sentiment_score) > 0.7 ? 'urgent' : 'high',
            title: `📰 Breaking News: ${asset.symbol}`,
            message: `${newsData.sentiment_label.replace('_', ' ').toUpperCase()} sentiment detected. ${newsData.key_headlines?.[0] || 'Significant news event.'}`,
            data: {
              asset: asset.symbol,
              news_sentiment: newsData.sentiment_label,
              sentiment_score: newsData.sentiment_score,
              impact: newsData.impact_level,
              price: asset.price,
              change: asset.change24h
            }
          };

          try {
            await base44.entities.Notification.create(notification);
            setActiveToast(notification);
            window[cacheKey] = Date.now();
          } catch (error) {
            console.warn('⚠️ Failed to create news notification:', error.message);
          }
        }
      }
    };

    // INCREASED: Check news alerts every 3 minutes (was 60s)
    const interval = setInterval(checkNewsAlerts, 180000);
    checkNewsAlerts();

    return () => clearInterval(interval);
  }, [assets]);

  return {
    activeToast,
    clearToast: () => setActiveToast(null)
  };
}