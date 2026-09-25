import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { secrets } from "base44:runtime";
import { encryptApiKey, decryptApiKey, fingerprintApiKey } from "../../shared/aiModelCrypto.ts";
import { callCustomLLM } from "../../shared/customLLM.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { action, config } = body;

    // ── SAVE ──────────────────────────────────────────────
    if (action === "save") {
      const existing = await base44.entities.AIModelConfig.list();
      const keyHex = secrets.get("EXCHANGE_ENCRYPTION_KEY");
      if (!keyHex) return Response.json({ error: "Encryption key not configured" }, { status: 500 });

      const updateData = { ...config };
      // Encrypt the API key only when a new plaintext key is provided
      if (config.encrypted_api_key && config.encrypted_api_key !== "***" && config.encrypted_api_key !== "") {
        updateData.encrypted_api_key = encryptApiKey(config.encrypted_api_key, keyHex);
        updateData.api_key_fingerprint = fingerprintApiKey(config.encrypted_api_key);
      } else {
        delete updateData.encrypted_api_key; // don't touch the existing encrypted key
      }

      if (existing[0]) {
        await base44.entities.AIModelConfig.update(existing[0].id, updateData);
      } else {
        await base44.entities.AIModelConfig.create({ config_name: "default", ...updateData });
      }
      return Response.json({ success: true });
    }

    // ── TEST ──────────────────────────────────────────────
    if (action === "test") {
      const existing = await base44.entities.AIModelConfig.list();
      const cfg = existing[0];
      if (!cfg) return Response.json({ error: "No config found. Save first." }, { status: 400 });

      if (cfg.model_source === "platform") {
        const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: 'Respond with exactly: {"status":"ok"}',
          model: cfg.platform_model || "automatic",
          response_json_schema: {
            type: "object",
            properties: { status: { type: "string" } },
            required: ["status"],
          },
        });
        await base44.entities.AIModelConfig.update(cfg.id, {
          last_tested_at: new Date().toISOString(),
          test_result: { success: true, model: cfg.platform_model, timestamp: new Date().toISOString() },
        });
        return Response.json({ success: true, result });
      } else {
        if (!cfg.encrypted_api_key) return Response.json({ error: "No API key set" }, { status: 400 });
        const keyHex = secrets.get("EXCHANGE_ENCRYPTION_KEY");
        const apiKey = decryptApiKey(cfg.encrypted_api_key, keyHex);
        const result = await callCustomLLM(
          { provider: cfg.custom_provider, modelName: cfg.custom_model_name, apiKey },
          'Respond with exactly this JSON: {"approve":true,"confidence":100,"reasoning":"Connection test successful"}'
        );
        await base44.entities.AIModelConfig.update(cfg.id, {
          last_tested_at: new Date().toISOString(),
          test_result: { success: true, provider: cfg.custom_provider, timestamp: new Date().toISOString() },
        });
        return Response.json({ success: true, result });
      }
    }

    // ── GET (default) ────────────────────────────────────
    const existing = await base44.entities.AIModelConfig.list();
    if (!existing[0]) return Response.json({ config: null });
    const cfg = existing[0];
    // Never return the encrypted key to the client — just whether one exists
    return Response.json({
      config: { ...cfg, encrypted_api_key: cfg.api_key_fingerprint ? "***" : "" },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}