export async function callCustomLLM(config, prompt, responseSchema) {
  if (config.provider === "openai") {
    return callOpenAI(config, prompt, responseSchema);
  } else if (config.provider === "anthropic") {
    return callAnthropic(config, prompt, responseSchema);
  } else if (config.provider === "google") {
    return callGoogle(config, prompt, responseSchema);
  }
  throw new Error("Unsupported provider: " + config.provider);
}

function extractJSON(text) {
  try {
    return JSON.parse(text);
  } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }
  throw new Error("No valid JSON in LLM response");
}

async function callOpenAI(config, prompt, responseSchema) {
  const body = {
    model: config.modelName,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
  };
  if (responseSchema) {
    body.response_format = { type: "json_object" };
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + config.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error("OpenAI API error (" + res.status + "): " + err);
  }
  const data = await res.json();
  const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "{}";
  return extractJSON(content);
}

async function callAnthropic(config, prompt, _responseSchema) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.modelName,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error("Anthropic API error (" + res.status + "): " + err);
  }
  const data = await res.json();
  const content = (data.content && data.content[0] && data.content[0].text) || "{}";
  return extractJSON(content);
}

async function callGoogle(config, prompt, responseSchema) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3 },
  };
  if (responseSchema) {
    body.generationConfig.responseMimeType = "application/json";
  }
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" +
      config.modelName +
      ":generateContent",
    {
      method: "POST",
      // Header auth: a ?key= query parameter would leak the key into any
      // outbound request, proxy, or error log along the way.
      headers: {
        "x-goog-api-key": config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error("Google AI API error (" + res.status + "): " + err);
  }
  const data = await res.json();
  const content =
    (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) ||
    "{}";
  return extractJSON(content);
}