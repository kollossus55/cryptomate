import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Cpu, Sparkles, Key, CheckCircle, AlertCircle, Loader2, Zap, Globe, Brain } from "lucide-react";

const PLATFORM_MODELS = [
  { id: "automatic", name: "Automatic (Recommended)", description: "Platform chooses the best model for the task" },
  { id: "gemini_3_8_flash", name: "Gemini 3.8 Flash", description: "Fast, supports web search — good for real-time analysis" },
  { id: "gpt_6_luna", name: "GPT-6 Luna", description: "Balanced quality and speed" },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5", description: "Strong reasoning for complex signal analysis" },
  { id: "claude_opus_5_5", name: "Claude Opus 5.5", description: "Best reasoning, higher credit cost" },
  { id: "gpt_6_sol", name: "GPT-6 Sol", description: "High quality analysis" },
  { id: "gpt_6_astra", name: "GPT-6 Astra", description: "High quality analysis" },
  { id: "claude_fable_5_1", name: "Claude Fable 5.1", description: "Specialised reasoning model" },
  { id: "glm_5_2", name: "GLM 5.2", description: "Alternative model — no file support" },
];

const CUSTOM_PROVIDERS = [
  { id: "openai", name: "OpenAI", placeholder: "gpt-4o, gpt-4o-mini, o1-mini…" },
  { id: "anthropic", name: "Anthropic", placeholder: "claude-3-5-sonnet-20241022…" },
  { id: "google", name: "Google AI", placeholder: "gemini-1.5-flash, gemini-1.5-pro…" },
];

export default function AISettings() {
  const [config, setConfig] = useState({
    model_source: "platform",
    platform_model: "automatic",
    custom_provider: "openai",
    custom_model_name: "",
    encrypted_api_key: "",
    api_key_fingerprint: "",
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const response = await base44.functions.invoke("aiModelConfig", { action: "get" });
      if (response.data?.config) {
        setConfig((prev) => ({
          ...prev,
          ...response.data.config,
          encrypted_api_key: "",
        }));
      }
    } catch (e) {
      console.error("Failed to load AI config:", e);
    } finally {
      setLoaded(true);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await base44.functions.invoke("aiModelConfig", { action: "save", config });
      setConfig((prev) => ({ ...prev, encrypted_api_key: "" }));
      await loadConfig();
    } catch (e) {
      console.error("Failed to save:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await base44.functions.invoke("aiModelConfig", { action: "test" });
      setTestResult(response.data);
    } catch (e) {
      setTestResult({ error: e.message || "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a111d] text-white relative overflow-hidden">
      {/* Radial gradient overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 80% 4%, #243451 0, transparent 38%)" }}
      />

      <div className="relative max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#303b68] to-[#3c316a] flex items-center justify-center shadow-lg">
            <Cpu className="w-6 h-6 text-[#a6a2ff]" />
          </div>
          <div>
            <h1
              className="text-3xl font-bold text-[#f1f3ff]"
              style={{ letterSpacing: "-0.035em" }}
            >
              AI Model Settings
            </h1>
            <p className="text-[#92a0b7] text-sm mt-1">
              Choose which AI model reviews your trade signals
            </p>
          </div>
        </div>

        {/* Main Panel */}
        <div
          className="rounded-[22px] border border-[#29384d] bg-gradient-to-br from-[#172235] to-[#111a29] shadow-2xl"
          style={{ animation: "arrive 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) both" }}
        >
          {/* Panel Header */}
          <div className="flex items-center gap-4 p-7 border-b border-[#29384d]">
            <div className="w-12 h-12 rounded-[15px] bg-gradient-to-br from-[#303b68] to-[#3c316a] flex items-center justify-center shadow-lg">
              <Sparkles className="w-6 h-6 text-[#a6a2ff]" />
            </div>
            <h2
              className="text-2xl font-bold text-[#f1f3ff]"
              style={{ letterSpacing: "-0.035em" }}
            >
              AI Configuration
            </h2>
          </div>

          {/* Panel Content */}
          <div className="p-8 space-y-6">
            {/* Model Source */}
            <div>
              <Label className="text-[#d4dcf0] mb-3 block font-medium">Model Source</Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setConfig({ ...config, model_source: "platform" })}
                  className={`p-4 rounded-[13px] border flex flex-col items-center gap-2 transition-all ${
                    config.model_source === "platform"
                      ? "text-white border-[#988bff] bg-gradient-to-br from-[#6657c5] to-[#503da0] shadow-lg"
                      : "text-[#aebbd0] border-[#344159] bg-[#1b2638] hover:bg-[#25334a] hover:border-[#6874a0] hover:text-white"
                  }`}
                  style={{
                    transition:
                      "background 0.18s, border-color 0.18s, color 0.18s, box-shadow 0.18s, transform 0.18s",
                  }}
                >
                  <Sparkles className="w-5 h-5" />
                  <span className="text-sm font-semibold">Platform Model</span>
                  <span className="text-xs opacity-70">No API key needed</span>
                </button>
                <button
                  onClick={() => setConfig({ ...config, model_source: "custom" })}
                  className={`p-4 rounded-[13px] border flex flex-col items-center gap-2 transition-all ${
                    config.model_source === "custom"
                      ? "text-white border-[#988bff] bg-gradient-to-br from-[#6657c5] to-[#503da0] shadow-lg"
                      : "text-[#aebbd0] border-[#344159] bg-[#1b2638] hover:bg-[#25334a] hover:border-[#6874a0] hover:text-white"
                  }`}
                  style={{
                    transition:
                      "background 0.18s, border-color 0.18s, color 0.18s, box-shadow 0.18s, transform 0.18s",
                  }}
                >
                  <Key className="w-5 h-5" />
                  <span className="text-sm font-semibold">Custom API Key</span>
                  <span className="text-xs opacity-70">Use your own provider</span>
                </button>
              </div>
              <p className="text-[#92a0b7] text-xs mt-2">
                {config.model_source === "platform"
                  ? "Platform models use integration credits. No setup required — just pick a model."
                  : "Bring your own API key from OpenAI, Anthropic, or Google. Your key is encrypted at rest."}
              </p>
            </div>

            {/* Platform Model Selection */}
            {config.model_source === "platform" && (
              <div
                className="rounded-[18px] border border-[#6257a75c] bg-gradient-to-br from-[#191d37] to-[#171b2b] p-6"
                style={{ animation: "arrive 0.65s cubic-bezier(0.2, 0.8, 0.2, 1) both" }}
              >
                <Label className="text-[#e2dcff] mb-3 block font-medium">Platform Model</Label>
                <select
                  value={config.platform_model}
                  onChange={(e) => setConfig({ ...config, platform_model: e.target.value })}
                  className="w-full bg-[#1b2638] border border-[#344159] text-white rounded-lg px-4 py-3 text-sm focus:border-[#988bff] focus:outline-none focus:ring-2 focus:ring-[#988bff]/30"
                >
                  {PLATFORM_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <p className="text-[#92a0b7] text-xs mt-2">
                  {PLATFORM_MODELS.find((m) => m.id === config.platform_model)?.description || ""}
                </p>
                {config.platform_model !== "automatic" && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-amber-400">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Non-default models use more integration credits</span>
                  </div>
                )}
              </div>
            )}

            {/* Custom API Key Configuration */}
            {config.model_source === "custom" && (
              <div
                className="rounded-[18px] border border-[#6257a75c] bg-gradient-to-br from-[#191d37] to-[#171b2b] p-6 space-y-4"
                style={{ animation: "arrive 0.65s cubic-bezier(0.2, 0.8, 0.2, 1) both" }}
              >
                {/* Provider */}
                <div>
                  <Label className="text-[#e2dcff] mb-2 block font-medium">Provider</Label>
                  <select
                    value={config.custom_provider}
                    onChange={(e) => setConfig({ ...config, custom_provider: e.target.value })}
                    className="w-full bg-[#1b2638] border border-[#344159] text-white rounded-lg px-4 py-3 text-sm focus:border-[#988bff] focus:outline-none focus:ring-2 focus:ring-[#988bff]/30"
                  >
                    {CUSTOM_PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Model Name */}
                <div>
                  <Label className="text-[#e2dcff] mb-2 block font-medium">Model Name</Label>
                  <Input
                    type="text"
                    value={config.custom_model_name}
                    onChange={(e) => setConfig({ ...config, custom_model_name: e.target.value })}
                    placeholder={
                      CUSTOM_PROVIDERS.find((p) => p.id === config.custom_provider)?.placeholder ||
                      "model-name"
                    }
                    className="bg-[#1b2638] border-[#344159] text-white focus:border-[#988bff] focus:ring-[#988bff]/30"
                  />
                </div>

                {/* API Key */}
                <div>
                  <Label className="text-[#e2dcff] mb-2 block font-medium">API Key</Label>
                  <Input
                    type="password"
                    value={config.encrypted_api_key}
                    onChange={(e) =>
                      setConfig({ ...config, encrypted_api_key: e.target.value })
                    }
                    placeholder={
                      config.api_key_fingerprint
                        ? `Current: ${config.api_key_fingerprint} (enter new to replace)`
                        : "Enter your API key"
                    }
                    className="bg-[#1b2638] border-[#344159] text-white focus:border-[#988bff] focus:ring-[#988bff]/30"
                  />
                  <p className="text-[#92a0b7] text-xs mt-1.5">
                    Your API key is encrypted with AES-256-GCM before storage. Never shared or
                    logged.
                  </p>
                </div>
              </div>
            )}

            {/* Test + Save */}
            <div className="flex items-center gap-3 pt-2">
              <Button
                onClick={handleTest}
                disabled={testing || !loaded}
                variant="outline"
                className="border-[#344159] bg-[#1b2638] text-[#aebbd0] hover:bg-[#25334a] hover:text-white"
              >
                {testing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 mr-2" />
                    Test Connection
                  </>
                )}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !loaded}
                className="bg-gradient-to-r from-[#6657c5] to-[#503da0] hover:from-[#7564db] hover:to-[#6249c2] text-white"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Save Settings
                  </>
                )}
              </Button>
            </div>

            {/* Test Result */}
            {testResult && (
              <div
                className={`rounded-xl p-4 border ${
                  testResult.success
                    ? "bg-green-500/10 border-green-500/30"
                    : "bg-red-500/10 border-red-500/30"
                }`}
              >
                <div className="flex items-center gap-2">
                  {testResult.success ? (
                    <>
                      <CheckCircle className="w-5 h-5 text-green-400" />
                      <span className="text-green-300 font-medium">Connection successful</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-5 h-5 text-red-400" />
                      <span className="text-red-300 font-medium">Connection failed</span>
                    </>
                  )}
                </div>
                {testResult.error && (
                  <p className="text-red-300/70 text-sm mt-2">{testResult.error}</p>
                )}
                {testResult.success && (
                  <p className="text-green-300/70 text-sm mt-2">
                    Model responded successfully. Ready to use for AI trade confirmation.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Footer bar */}
          <div
            className="h-[2px] mx-8 mb-6 rounded-full"
            style={{
              background: "linear-gradient(90deg, #8679f4, #54c5b0 56%, transparent)",
              animation: "glow 3.8s ease-in-out infinite",
            }}
          />
        </div>

        {/* Info Card */}
        <div className="mt-6 rounded-[22px] border border-[#29384d] bg-gradient-to-br from-[#172235] to-[#111a29] p-6">
          <h3 className="text-[#d4dcf0] font-semibold mb-3 flex items-center gap-2">
            <Brain className="w-4 h-4 text-[#a6a2ff]" />
            How It Works
          </h3>
          <div className="space-y-2 text-sm text-[#92a0b7]">
            <p>
              <span className="text-[#a9a4ff] font-medium">Platform models</span> use the built-in
              InvokeLLM integration. No API keys needed — you pay with integration credits.
            </p>
            <p>
              <span className="text-[#a9a4ff] font-medium">Custom API keys</span> let you use your
              own OpenAI, Anthropic, or Google account. Your key is encrypted and stored securely.
              The AI confirmation gate uses this model to review each trade signal.
            </p>
            <p>
              The auto-trading worker reads this config when AI confirmation is set to{" "}
              <span className="text-[#a9a4ff] font-medium">Auto AI Gate</span> or{" "}
              <span className="text-[#a9a4ff] font-medium">Manual Approve</span>.
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes arrive {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes glow {
          0%, 100% { opacity: 0.48; filter: brightness(0.9); }
          50% { opacity: 0.95; filter: brightness(1.25); }
        }
      `}</style>
    </div>
  );
}