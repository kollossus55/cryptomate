import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Zap, 
  AlertCircle, 
  Clock, 
  CheckCircle2,
  XCircle,
  Wifi,
  Lock
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function LiveTradingSimulation({ connection, asset, tradeType, onClose }) {
  const [stage, setStage] = useState('validating'); // validating, signing, executing, completed, failed
  const [progress, setProgress] = useState(0);
  const [orderDetails, setOrderDetails] = useState(null);

  useEffect(() => {
    simulateTradeExecution();
  }, []);

  const simulateTradeExecution = async () => {
    // Stage 1: Validating
    setStage('validating');
    setProgress(20);
    await sleep(1000);

    // Stage 2: Signing request
    setStage('signing');
    setProgress(50);
    await sleep(1500);

    // Stage 3: Executing on exchange
    setStage('executing');
    setProgress(80);
    await sleep(2000);

    // Stage 4: Completed
    setStage('completed');
    setProgress(100);

    // Generate mock order details
    const executionPrice = asset.price * (1 + (Math.random() - 0.5) * 0.001); // Slight slippage
    setOrderDetails({
      orderId: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
      exchange: connection.exchange_name,
      symbol: `${asset.symbol}/USDT`,
      side: tradeType,
      price: executionPrice,
      status: 'FILLED',
      fillTime: new Date().toISOString()
    });
  };

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const stageConfig = {
    validating: {
      icon: AlertCircle,
      color: "text-yellow-400",
      title: "Validating Order",
      description: "Checking balance, limits, and order parameters..."
    },
    signing: {
      icon: Lock,
      color: "text-blue-400",
      title: "Signing Request",
      description: "Creating HMAC-SHA256 signature with API secret..."
    },
    executing: {
      icon: Zap,
      color: "text-purple-400",
      title: "Executing on Exchange",
      description: `Sending order to ${connection.exchange_name} API...`
    },
    completed: {
      icon: CheckCircle2,
      color: "text-green-400",
      title: "Order Executed Successfully",
      description: "Your order has been filled on the exchange"
    },
    failed: {
      icon: XCircle,
      color: "text-red-400",
      title: "Order Failed",
      description: "Failed to execute order. Please try again."
    }
  };

  const config = stageConfig[stage];
  const StageIcon = config.icon;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="max-w-lg w-full"
      >
        <Card className="bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Wifi className="w-5 h-5 text-indigo-400" />
              Live Trade Execution Simulation
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Notice Banner */}
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-6">
              <div className="flex gap-2">
                <AlertCircle className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-200">
                  <strong>Demo Mode:</strong> This simulates what would happen with real exchange integration. 
                  Actual execution requires backend functions.
                </p>
              </div>
            </div>

            {/* Progress Animation */}
            <div className="mb-6">
              <div className="flex items-center justify-center mb-4">
                <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center ${
                  stage === 'completed' ? 'animate-none' : 'animate-pulse'
                }`}>
                  <StageIcon className={`w-8 h-8 ${config.color}`} />
                </div>
              </div>

              <div className="text-center mb-4">
                <h3 className={`text-lg font-bold ${config.color} mb-1`}>
                  {config.title}
                </h3>
                <p className="text-sm text-slate-400">
                  {config.description}
                </p>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.3 }}
                  className={`h-full ${
                    stage === 'completed' 
                      ? 'bg-green-500' 
                      : stage === 'failed'
                      ? 'bg-red-500'
                      : 'bg-indigo-500'
                  }`}
                />
              </div>
              <p className="text-xs text-slate-500 text-center mt-2">
                {progress}% Complete
              </p>
            </div>

            {/* Order Details (when completed) */}
            <AnimatePresence>
              {stage === 'completed' && orderDetails && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4 mb-6"
                >
                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                    <h4 className="font-semibold text-green-400 mb-3">Order Confirmation</h4>
                    
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-slate-400 mb-1">Order ID</p>
                        <p className="text-white font-mono">{orderDetails.orderId}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 mb-1">Status</p>
                        <Badge className="bg-green-500/20 text-green-400">
                          {orderDetails.status}
                        </Badge>
                      </div>
                      <div>
                        <p className="text-slate-400 mb-1">Exchange</p>
                        <p className="text-white capitalize">{orderDetails.exchange}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 mb-1">Symbol</p>
                        <p className="text-white">{orderDetails.symbol}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 mb-1">Side</p>
                        <Badge className={tradeType === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}>
                          {orderDetails.side.toUpperCase()}
                        </Badge>
                      </div>
                      <div>
                        <p className="text-slate-400 mb-1">Fill Price</p>
                        <p className="text-white">${orderDetails.price.toFixed(2)}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-slate-400 mb-1">Fill Time</p>
                        <p className="text-white text-xs">
                          {new Date(orderDetails.fillTime).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* What Would Happen */}
                  <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg p-4">
                    <h4 className="font-semibold text-indigo-400 mb-2">What Would Happen in Live Mode:</h4>
                    <ul className="text-xs text-indigo-200 space-y-1">
                      <li>✓ Backend signs request with API secret (HMAC-SHA256)</li>
                      <li>✓ Order sent to {connection.exchange_name} API endpoint</li>
                      <li>✓ Exchange validates and executes order</li>
                      <li>✓ Your account balance updated</li>
                      <li>✓ Order recorded in database</li>
                      <li>✓ Real funds moved in your exchange account</li>
                    </ul>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Current Reality */}
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-4">
              <div className="flex gap-2">
                <Clock className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-yellow-200 font-semibold mb-1">Current Reality:</p>
                  <p className="text-xs text-yellow-200/80">
                    This is a simulation. Your paper trading portfolio remains active. 
                    To enable real trading, backend functions must be configured.
                  </p>
                </div>
              </div>
            </div>

            {/* Action Button */}
            <Button
              onClick={onClose}
              disabled={stage !== 'completed' && stage !== 'failed'}
              className="w-full bg-indigo-600 hover:bg-indigo-700"
            >
              {stage === 'completed' || stage === 'failed' ? 'Close' : 'Processing...'}
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}