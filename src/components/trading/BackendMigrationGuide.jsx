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

export default function BackendMigrationGuide({ isActive }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (isActive) {
    return (
      <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-green-500/30 mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-500/20 rounded-xl flex items-center justify-center">
                <Server className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <CardTitle className="text-white flex items-center gap-2">
                  Backend Trading Active
                  <Badge className="bg-green-500/20 text-green-300 border-green-500/30">
                    Live 24/7
                  </Badge>
                </CardTitle>
                <p className="text-xs text-slate-400 mt-1">
                  Server-side trading functions are running automatically
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
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="w-5 h-5 text-green-400" />
                    <h4 className="font-semibold text-white">System Fully Operational</h4>
                  </div>
                  <div className="grid md:grid-cols-3 gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-4 h-4 text-green-400" />
                        <span className="text-white font-medium text-sm">True 24/7</span>
                      </div>
                      <p className="text-xs text-slate-300">
                        Trading continues while you sleep or are offline
                      </p>
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="w-4 h-4 text-green-400" />
                        <span className="text-white font-medium text-sm">Reliable</span>
                      </div>
                      <p className="text-xs text-slate-300">
                        Server-grade execution without browser dependency
                      </p>
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Shield className="w-4 h-4 text-green-400" />
                        <span className="text-white font-medium text-sm">Secure</span>
                      </div>
                      <p className="text-xs text-slate-300">
                        Running in a secure backend environment
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-indigo-500/30 mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center">
              <Server className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <CardTitle className="text-white flex items-center gap-2">
                Server-Side Trading Active
                <Badge className="bg-green-500/20 text-green-300 border-green-500/30">
                  Backend Enhanced
                </Badge>
              </CardTitle>
              <p className="text-xs text-slate-400 mt-1">
                24/7 server-side execution is live — browser runs only as a fallback
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
              
              {/* Primary vs Fallback */}
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-slate-800 rounded-lg p-4 border border-green-500/30">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="w-5 h-5 text-green-400" />
                    <h4 className="font-semibold text-white">Primary: Server-Side</h4>
                  </div>
                  <ul className="space-y-2 text-sm text-slate-300">
                    <li className="flex items-start gap-2">
                      <span className="text-green-400 mt-1">✓</span>
                      <span>24/7 trading, even when you're offline</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-400 mt-1">✓</span>
                      <span>No browser or open tab required</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-400 mt-1">✓</span>
                      <span>Reliable scheduled execution</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-400 mt-1">✓</span>
                      <span>Server-grade performance & security</span>
                    </li>
                  </ul>
                </div>

                <div className="bg-slate-800 rounded-lg p-4 border border-orange-500/30">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertCircle className="w-5 h-5 text-orange-400" />
                    <h4 className="font-semibold text-white">Fallback: Browser</h4>
                  </div>
                  <ul className="space-y-2 text-sm text-slate-300">
                    <li className="flex items-start gap-2">
                      <span className="text-orange-400 mt-1">⚠️</span>
                      <span>Only used if server-side is unavailable</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-orange-400 mt-1">⚠️</span>
                      <span>Requires the page to stay open</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-orange-400 mt-1">⚠️</span>
                      <span>Stops when the browser closes</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-400 mt-1">✓</span>
                      <span>Keeps trading running during outages</span>
                    </li>
                  </ul>
                </div>
              </div>

              {/* Architecture */}
              <div className="bg-slate-800 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Code className="w-5 h-5 text-indigo-400" />
                  <h4 className="font-semibold text-white">Deployed Architecture</h4>
                </div>
                <p className="text-sm text-slate-300 mb-4">
                  The core trading logic is shared between the browser and the server worker,
                  so both use the same signal, risk, and execution modules:
                </p>
                <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs text-slate-300 space-y-2">
                  <div className="text-green-400">// Server-side (primary executor)</div>
                  <div className="text-purple-400">base44/functions/autoTradingWorker</div>
                  <div className="text-purple-400">base44/functions/tradingScheduler</div>
                  <div className="mt-3 text-green-400">// Shared engine (used by both server & browser)</div>
                  <div>shared/trading/signalEngine.js</div>
                  <div>shared/trading/risk.js</div>
                  <div>shared/trading/portfolio.js</div>
                </div>
              </div>

              {/* How It Works */}
              <div className="bg-slate-800 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-5 h-5 text-yellow-400" />
                  <h4 className="font-semibold text-white">How It Works</h4>
                </div>
                <div className="space-y-3">
                  <div className="flex gap-3">
                    <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
                      1
                    </div>
                    <div>
                      <p className="text-white font-medium">Server Worker Runs</p>
                      <p className="text-sm text-slate-400">
                        The V5 server worker executes trades on schedule for every user with auto-trading enabled
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
                      2
                    </div>
                    <div>
                      <p className="text-white font-medium">Browser Monitors</p>
                      <p className="text-sm text-slate-400">
                        The page watches trade activity and updates your view in real time
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-6 h-6 rounded-full bg-orange-500 flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
                      3
                    </div>
                    <div>
                      <p className="text-white font-medium">Fallback Engages If Needed</p>
                      <p className="text-sm text-slate-400">
                        If the server-side worker is unavailable, the browser takes over temporarily until it recovers
                      </p>
                    </div>
                  </div>
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
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-green-300 mb-2">✅ Backend Functions Deployed & Running</h4>
                <p className="text-xs text-green-200/90 mb-3">
                  Server-side trading is already live and processing every user with auto-trading enabled:
                </p>
                <div className="bg-slate-800/50 rounded-lg p-3 mb-3">
                  <ul className="text-xs text-slate-300 space-y-1">
                    <li>✅ <code className="text-green-400">autoTradingWorker</code> — Executes trades server-side</li>
                    <li>✅ <code className="text-green-400">tradingScheduler</code> — Runs on a fixed schedule</li>
                    <li>✅ <code className="text-green-400">technicalAnalysis</code> — Signal & indicator engine</li>
                  </ul>
                </div>
                <p className="text-xs text-green-200/80">
                  <strong>Browser fallback:</strong> If the server worker is ever unavailable, the browser
                  keeps trading running temporarily and resumes server-side execution automatically once it recovers.
                </p>
              </div>

            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}