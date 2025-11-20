import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Server, 
  Code, 
  Zap, 
  Clock, 
  Shield, 
  ChevronDown, 
  ChevronUp,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function BackendMigrationGuide() {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-indigo-500/30">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center">
              <Server className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <CardTitle className="text-white flex items-center gap-2">
                Backend Migration Ready
                <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30">
                  Future Enhancement
                </Badge>
              </CardTitle>
              <p className="text-xs text-slate-400 mt-1">
                Architecture prepared for 24/7 server-side trading
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-slate-400 hover:text-white"
          >
            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </Button>
        </div>
      </CardHeader>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            <CardContent className="space-y-6">
              
              {/* Current vs Future */}
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-slate-800 rounded-lg p-4 border border-orange-500/30">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertCircle className="w-5 h-5 text-orange-400" />
                    <h4 className="font-semibold text-white">Current: Browser-Based</h4>
                  </div>
                  <ul className="space-y-2 text-sm text-slate-300">
                    <li className="flex items-start gap-2">
                      <span className="text-orange-400 mt-1">⚠️</span>
                      <span>Requires page to stay open</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-orange-400 mt-1">⚠️</span>
                      <span>Stops when browser closes</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-orange-400 mt-1">⚠️</span>
                      <span>Throttled in background tabs</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-400 mt-1">✓</span>
                      <span>Works now, no setup needed</span>
                    </li>
                  </ul>
                </div>

                <div className="bg-slate-800 rounded-lg p-4 border border-green-500/30">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="w-5 h-5 text-green-400" />
                    <h4 className="font-semibold text-white">Future: Backend Functions</h4>
                  </div>
                  <ul className="space-y-2 text-sm text-slate-300">
                    <li className="flex items-start gap-2">
                      <span className="text-green-400 mt-1">✓</span>
                      <span>24/7 trading, even offline</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-400 mt-1">✓</span>
                      <span>No browser required</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-400 mt-1">✓</span>
                      <span>Reliable scheduling</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-400 mt-1">✓</span>
                      <span>Server-grade performance</span>
                    </li>
                  </ul>
                </div>
              </div>

              {/* Architecture */}
              <div className="bg-slate-800 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Code className="w-5 h-5 text-indigo-400" />
                  <h4 className="font-semibold text-white">Ready-to-Deploy Architecture</h4>
                </div>
                <p className="text-sm text-slate-300 mb-4">
                  The core trading logic is already extracted into platform-agnostic modules 
                  that can run on any backend:
                </p>
                <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs text-slate-300 space-y-2">
                  <div className="text-green-400">// Core engine (platform-agnostic)</div>
                  <div>components/trading/autoTradingEngine.js</div>
                  <div className="mt-3 text-green-400">// Functions you'd create on backend:</div>
                  <div className="text-purple-400">backend/functions/autoTradingWorker.js</div>
                  <div className="text-purple-400">backend/functions/priceMonitor.js</div>
                  <div className="text-purple-400">backend/functions/portfolioSync.js</div>
                </div>
              </div>

              {/* Migration Steps */}
              <div className="bg-slate-800 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-5 h-5 text-yellow-400" />
                  <h4 className="font-semibold text-white">Migration Steps (When Backend Support Added)</h4>
                </div>
                <div className="space-y-3">
                  <div className="flex gap-3">
                    <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
                      1
                    </div>
                    <div>
                      <p className="text-white font-medium">Create Backend Function</p>
                      <p className="text-sm text-slate-400">
                        Copy autoTradingEngine.js logic to a scheduled backend function
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
                      2
                    </div>
                    <div>
                      <p className="text-white font-medium">Set Schedule</p>
                      <p className="text-sm text-slate-400">
                        Configure cron job: */45 * * * * (every 45 seconds)
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
                      3
                    </div>
                    <div>
                      <p className="text-white font-medium">Update Settings Entity</p>
                      <p className="text-sm text-slate-400">
                        Add execution_mode: "backend" field to AutoTradingSettings
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
                      4
                    </div>
                    <div>
                      <p className="text-white font-medium">Test & Deploy</p>
                      <p className="text-sm text-slate-400">
                        Verify trades execute server-side, then remove browser logic
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Backend Function Example */}
              <div className="bg-slate-800 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Server className="w-5 h-5 text-purple-400" />
                  <h4 className="font-semibold text-white">Example Backend Function</h4>
                </div>
                <div className="bg-slate-900 rounded-lg p-4 overflow-x-auto">
                  <pre className="text-xs text-slate-300 font-mono">
{`// backend/functions/autoTradingWorker.js
import { executeAutoTradingCheck } from './autoTradingEngine.js';
import { fetchAssets, fetchConfidence } from './marketData.js';
import { executeTrade } from './tradeExecutor.js';

export async function handler(event, context) {
  // Fetch all users with auto-trading enabled
  const users = await db.query(
    'SELECT * FROM auto_trading_settings WHERE is_enabled = true'
  );
  
  for (const user of users) {
    try {
      // Get user's portfolio and settings
      const portfolio = await getPortfolio(user.id);
      const settings = user.settings;
      
      // Fetch latest market data
      const assets = await fetchAssets();
      const confidence = await fetchConfidence(assets);
      
      // Execute trading check (uses same logic!)
      const result = await executeAutoTradingCheck(
        assets,
        confidence,
        settings,
        portfolio,
        async (opportunity) => {
          // Execute actual trade
          await executeTrade(user.id, opportunity);
        }
      );
      
      console.log(\`User \${user.id}: \${result.reason}\`);
    } catch (error) {
      console.error(\`Error for user \${user.id}:\`, error);
    }
  }
  
  return { success: true };
}

// Schedule: Every 45 seconds
// Cron: */45 * * * * *`}
                  </pre>
                </div>
              </div>

              {/* Benefits */}
              <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="w-5 h-5 text-green-400" />
                  <h4 className="font-semibold text-white">Why This Architecture Matters</h4>
                </div>
                <div className="grid md:grid-cols-3 gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="w-4 h-4 text-green-400" />
                      <span className="text-white font-medium text-sm">True 24/7</span>
                    </div>
                    <p className="text-xs text-slate-300">
                      Trade while you sleep, work, or are offline
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Zap className="w-4 h-4 text-yellow-400" />
                      <span className="text-white font-medium text-sm">Reliable</span>
                    </div>
                    <p className="text-xs text-slate-300">
                      No browser throttling or tab management issues
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Server className="w-4 h-4 text-purple-400" />
                      <span className="text-white font-medium text-sm">Scalable</span>
                    </div>
                    <p className="text-xs text-slate-300">
                      Handle thousands of users simultaneously
                    </p>
                  </div>
                </div>
              </div>

              {/* Current State */}
              <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-orange-300 mb-2">📋 Current Platform Status</h4>
                <p className="text-xs text-orange-200/80">
                  The Base44 platform currently doesn't support scheduled backend functions. 
                  However, the trading logic is <strong>already structured</strong> to work server-side 
                  when that capability is added. No code rewrite needed - just deploy the existing 
                  autoTradingEngine.js to a backend function and configure the schedule.
                </p>
              </div>

            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}