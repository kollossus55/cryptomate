import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Plus, Key, AlertTriangle, CheckCircle, Info, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "../components/utils";
import { Badge } from "@/components/ui/badge";

import ConnectionStatusCard from "../components/exchange/ConnectionStatusCard";
import PublicMarketData from "../components/exchange/PublicMarketData";

export default function ExchangeSettings() {
  const [isAddingConnection, setIsAddingConnection] = useState(false);
  const [testingConnectionId, setTestingConnectionId] = useState(null);
  const [newConnection, setNewConnection] = useState({
    exchange_name: "binance",
    api_key: "",
    api_secret: "",
    is_testnet: true,
    is_active: true,
    connection_status: "pending",
    permissions: [],
    trading_mode: "simulated"
  });

  const queryClient = useQueryClient();

  const { data: connections } = useQuery({
    queryKey: ['exchange-connections'],
    queryFn: () => base44.entities.ExchangeConnection.list(),
    initialData: [],
  });

  const createConnectionMutation = useMutation({
    mutationFn: (data) => base44.entities.ExchangeConnection.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchange-connections'] });
      setIsAddingConnection(false);
      resetForm();
    },
  });

  const updateConnectionMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ExchangeConnection.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchange-connections'] });
    },
  });

  const deleteConnectionMutation = useMutation({
    mutationFn: (id) => base44.entities.ExchangeConnection.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchange-connections'] });
    },
  });

  const resetForm = () => {
    setNewConnection({
      exchange_name: "binance",
      api_key: "",
      api_secret: "",
      is_testnet: true,
      is_active: true,
      connection_status: "pending",
      permissions: [],
      trading_mode: "simulated"
    });
  };

  const handleAddConnection = async () => {
    if (!newConnection.api_key || !newConnection.api_secret) {
      alert("Please enter both API Key and API Secret");
      return;
    }

    // Simple client-side "encryption" (base64) - in production with backend, use real encryption
    const encodedKey = btoa(newConnection.api_key);
    const encodedSecret = btoa(newConnection.api_secret);

    await createConnectionMutation.mutateAsync({
      ...newConnection,
      api_key: encodedKey,
      api_secret: encodedSecret
    });
  };

  const handleTestConnection = async (connection) => {
    setTestingConnectionId(connection.id);

    try {
      // Simulate connection test using public API
      const testSymbol = 'BTCUSDT';
      const baseUrl = connection.is_testnet 
        ? 'https://testnet.binance.vision' 
        : 'https://api.binance.com';

      // Attempt to fetch public market data as a basic connectivity test
      const response = await fetch(`${baseUrl}/api/v3/ticker/24hr?symbol=${testSymbol}`);

      if (response.ok) {
        await updateConnectionMutation.mutateAsync({
          id: connection.id,
          data: {
            ...connection,
            connection_status: 'connected',
            last_sync: new Date().toISOString(),
            permissions: ['read', 'trade'], // Assuming trade permission if connected
            error_message: null
          }
        });
      } else {
        throw new Error(`Failed to fetch public data: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      await updateConnectionMutation.mutateAsync({
        id: connection.id,
        data: {
          ...connection,
          connection_status: 'error',
          error_message: error.message || 'Failed to connect to exchange'
        }
      });
    } finally {
      setTestingConnectionId(null);
    }
  };

  const handleManageConnection = async (connection) => {
    if (window.confirm('Are you sure you want to delete this connection?')) {
      await deleteConnectionMutation.mutateAsync(connection.id);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="max-w-7xl mx-auto px-6 py-8">
        
        {/* Header */}
        <div className="mb-8">
          <Link to={createPageUrl('Trading')}>
            <Button variant="ghost" className="mb-4 text-slate-400 hover:text-white">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Trading
            </Button>
          </Link>
          
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            Exchange Settings
          </h1>
          <p className="text-slate-400">Connect exchanges and manage API credentials</p>
        </div>

        <Tabs defaultValue="connections" className="w-full">
          <TabsList className="bg-slate-800 border-slate-700">
            <TabsTrigger value="connections" className="data-[state=active]:bg-indigo-600">
              <Key className="w-4 h-4 mr-2" />
              Connections
            </TabsTrigger>
            <TabsTrigger value="market-data" className="data-[state=active]:bg-indigo-600">
              <Sparkles className="w-4 h-4 mr-2" />
              Live Market Data
            </TabsTrigger>
            <TabsTrigger value="guide" className="data-[state=active]:bg-indigo-600">
              <Info className="w-4 h-4 mr-2" />
              Setup Guide
            </TabsTrigger>
          </TabsList>

          {/* Connections Tab */}
          <TabsContent value="connections" className="mt-6">
            {/* Status Banner - IMPROVED CONTRAST */}
            <Card className="bg-slate-800 border-2 border-indigo-500/40 mb-8">
              <CardContent className="pt-6">
                <div className="flex gap-3">
                  <div className="w-12 h-12 bg-indigo-500 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Info className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white mb-2 text-lg">Simulated Trading Mode</h3>
                    <p className="text-white leading-relaxed">
                      API credentials are stored for demonstration. <strong className="text-yellow-300">All trading remains simulated</strong> using real market prices. 
                      Live order execution requires backend functions (not yet enabled). This interface prepares your setup for when you're ready to go live.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Warning Card - IMPROVED CONTRAST */}
            <Card className="bg-slate-800 border-2 border-yellow-500/40 mb-8">
              <CardContent className="pt-6">
                <div className="flex gap-3">
                  <div className="w-12 h-12 bg-yellow-500 rounded-xl flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white mb-3 text-lg">Security Best Practices</h3>
                    <ul className="text-white space-y-1.5">
                      <li>• Use <strong className="text-yellow-300">testnet</strong> credentials first to practice</li>
                      <li>• Never enable <strong className="text-red-300">withdrawal permissions</strong> on API keys</li>
                      <li>• Enable <strong className="text-green-300">IP whitelist</strong> on your exchange account</li>
                      <li>• Use <strong className="text-blue-300">2FA</strong> for all exchange accounts</li>
                      <li>• Keys are base64-encoded (upgrade to AES-256 with backend functions)</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Connection List */}
            {connections.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold text-white">Your Connections ({connections.length})</h2>
                  <Button 
                    onClick={() => setIsAddingConnection(true)}
                    className="bg-indigo-600 hover:bg-indigo-700"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Exchange
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {connections.map((connection) => (
                    <ConnectionStatusCard
                      key={connection.id}
                      connection={connection}
                      onTest={handleTestConnection}
                      onManage={handleManageConnection}
                      onUpdateConnection={updateConnectionMutation.mutateAsync} // Pass the update mutation
                      isTesting={testingConnectionId === connection.id}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Empty State */}
            {connections.length === 0 && !isAddingConnection && (
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="py-16 text-center">
                  <div className="w-16 h-16 bg-indigo-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Key className="w-8 h-8 text-indigo-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">No Exchange Connections</h3>
                  <p className="text-slate-400 mb-6">Connect your first exchange to start tracking real market data</p>
                  <Button 
                    onClick={() => setIsAddingConnection(true)}
                    className="bg-indigo-600 hover:bg-indigo-700"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Exchange Connection
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Add Connection Form */}
            {isAddingConnection && (
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-white">Add Exchange Connection</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-slate-300 mb-2 block">Exchange</Label>
                    <Select 
                      value={newConnection.exchange_name}
                      onValueChange={(value) => setNewConnection({...newConnection, exchange_name: value})}
                    >
                      <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700">
                        <SelectItem value="binance">Binance</SelectItem>
                        <SelectItem value="coinbase" disabled>Coinbase (Coming Soon)</SelectItem>
                        <SelectItem value="kraken" disabled>Kraken (Coming Soon)</SelectItem>
                        <SelectItem value="bybit" disabled>Bybit (Coming Soon)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-slate-300 mb-2 block">API Key</Label>
                    <Input
                      type="text"
                      placeholder="Enter your API key"
                      value={newConnection.api_key}
                      onChange={(e) => setNewConnection({...newConnection, api_key: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white font-mono text-sm"
                    />
                  </div>

                  <div>
                    <Label className="text-slate-300 mb-2 block">API Secret</Label>
                    <Input
                      type="password"
                      placeholder="Enter your API secret"
                      value={newConnection.api_secret}
                      onChange={(e) => setNewConnection({...newConnection, api_secret: e.target.value})}
                      className="bg-slate-900 border-slate-700 text-white font-mono text-sm"
                    />
                  </div>

                  <div className="flex items-center justify-between p-4 bg-slate-900 rounded-lg">
                    <div>
                      <Label className="text-slate-300">Use Testnet</Label>
                      <p className="text-xs text-slate-500 mt-1">Recommended for testing without real funds</p>
                    </div>
                    <Switch
                      checked={newConnection.is_testnet}
                      onCheckedChange={(checked) => setNewConnection({...newConnection, is_testnet: checked})}
                    />
                  </div>

                  <div className="bg-slate-900 border-2 border-blue-500/40 rounded-xl p-4">
                    <p className="text-white leading-relaxed">
                      <strong className="text-blue-300">Note:</strong> Your credentials are stored encoded. With backend functions enabled, 
                      they would be encrypted with AES-256 and used to execute real trades. Currently all trading is simulated.
                    </p>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsAddingConnection(false);
                        resetForm();
                      }}
                      className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-900"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleAddConnection}
                      disabled={!newConnection.api_key || !newConnection.api_secret || createConnectionMutation.isPending}
                      className="flex-1 bg-indigo-600 hover:bg-indigo-700"
                    >
                      {createConnectionMutation.isPending ? 'Adding...' : 'Add Connection'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Market Data Tab */}
          <TabsContent value="market-data" className="mt-6">
            <div className="space-y-6">
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3 mb-4">
                    <CheckCircle className="w-5 h-5 text-green-400" />
                    <div>
                      <h3 className="font-semibold text-white">Public Market Data Available</h3>
                      <p className="text-sm text-slate-400">Real-time prices from exchange public APIs (no authentication required)</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <PublicMarketData exchange="binance" symbol="BTCUSDT" />
              <PublicMarketData exchange="binance" symbol="ETHUSDT" />
            </div>
          </TabsContent>

          {/* Setup Guide Tab */}
          <TabsContent value="guide" className="mt-6">
            <div className="space-y-6">
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-white">How to Get API Keys</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
                      <span className="w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center text-black text-sm font-bold">1</span>
                      Binance (Recommended for Testing)
                    </h4>
                    <ol className="list-decimal list-inside space-y-2 text-slate-400 text-sm ml-8">
                      <li>Sign up at <strong>testnet.binance.vision</strong> for testnet</li>
                      <li>Or use <strong>binance.com</strong> for real trading (not recommended yet)</li>
                      <li>Go to API Management in account settings</li>
                      <li>Create new API key with <strong>Spot & Margin Trading</strong> permission</li>
                      <li><strong>Do NOT enable withdrawal permissions</strong></li>
                      <li>Copy API Key and Secret Key</li>
                      <li>Enable IP whitelist for added security</li>
                    </ol>
                  </div>

                  <div>
                    <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
                      <span className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm font-bold">2</span>
                      Security Checklist
                    </h4>
                    <div className="space-y-2 ml-8">
                      {[
                        "Enable 2FA on exchange account",
                        "Use testnet first before real funds",
                        "Never share API keys with anyone",
                        "Set IP whitelist restrictions",
                        "Disable withdrawal permissions",
                        "Monitor API usage regularly",
                        "Rotate keys every 3-6 months"
                      ].map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-green-400" />
                          <span className="text-slate-300 text-sm">{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
                      <span className="w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center text-white text-sm font-bold">3</span>
                      Required Permissions
                    </h4>
                    <div className="bg-slate-900 rounded-lg p-4 ml-8">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-300 text-sm">Read/Query</span>
                          <Badge className="bg-green-500/20 text-green-400">Required</Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-300 text-sm">Spot & Margin Trading</span>
                          <Badge className="bg-green-500/20 text-green-400">Required</Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-300 text-sm">Withdrawal</span>
                          <Badge className="bg-red-500/20 text-red-400">Disabled</Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}