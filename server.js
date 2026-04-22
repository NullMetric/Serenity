import { createServer } from "node:http";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const storePath = path.join(dataDir, "store.json");

loadEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3000);
const SITE_NAME = process.env.SITE_NAME || "Serenity";
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@example.com";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_FALLBACK_MODELS = [GEMINI_MODEL, "gemini-2.5-flash-lite", "gemini-2.0-flash"];

const DEFAULT_STORE = {
  moods: [],
  journals: [],
  chats: [],
  settings: {
    siteName: SITE_NAME,
    supportEmail: SUPPORT_EMAIL
  }
};

const CRISIS_MESSAGE =
  "It sounds like you may be in immediate distress. Serenity is not an emergency service. Please contact your local emergency number right now, go to the nearest emergency room, or reach out to a trusted person nearby. If you are in the U.S. or Canada, call or text 988 for the Suicide & Crisis Lifeline.";

const BREATHING_EXERCISE = [
  "Sit comfortably with both feet grounded.",
  "Inhale slowly through your nose for 4 seconds.",
  "Hold that breath gently for 7 seconds.",
  "Exhale slowly through your mouth for 8 seconds.",
  "Repeat the cycle 4 times, keeping your shoulders relaxed."
];

const GROUNDING_EXERCISE = [
  "Name 5 things you can see.",
  "Name 4 things you can touch.",
  "Name 3 things you can hear.",
  "Name 2 things you can smell.",
  "Name 1 thing you can taste."
];

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(res, url);
  } catch (error) {
    console.error("Unhandled server error", error);
    sendJson(res, 500, {
      error: "Server error",
      details: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

server.listen(PORT, () => {
  console.log(`${SITE_NAME} is running on http://localhost:${PORT}`);
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      siteName: SITE_NAME,
      geminiConfigured: Boolean(GEMINI_API_KEY),
      geminiModel: GEMINI_MODEL,
      fallbackModels: GEMINI_FALLBACK_MODELS.slice(1)
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    const store = await readStore();
    sendJson(res, 200, buildDashboardResponse(store));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/moods") {
    const body = await readJsonBody(req);
    if (!body?.label || typeof body.score !== "number") {
      sendJson(res, 400, { error: "Mood label and numeric score are required." });
      return;
    }

    const store = await readStore();
    const entry = {
      id: crypto.randomUUID(),
      label: String(body.label),
      score: Number(body.score),
      note: String(body.note || ""),
      createdAt: new Date().toISOString()
    };

    store.moods.push(entry);
    await writeStore(store);
    sendJson(res, 201, {
      message: "Mood saved.",
      entry,
      dashboard: buildDashboardResponse(store)
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/journal") {
    const body = await readJsonBody(req);
    const content = String(body?.content || "").trim();

    if (!content) {
      sendJson(res, 400, { error: "Journal content is required." });
      return;
    }

    const store = await readStore();
    const reflectionResult = await safeJournalReflection(content);
    const entry = {
      id: crypto.randomUUID(),
      content,
      createdAt: new Date().toISOString(),
      wordCount: countWords(content),
      reflection: reflectionResult.text,
      reflectionSource: reflectionResult.source
    };

    store.journals.push(entry);
    await writeStore(store);
    sendJson(res, 201, {
      message: "Journal entry saved.",
      entry,
      reflection: reflectionResult.text,
      reflectionSource: reflectionResult.source,
      dashboard: buildDashboardResponse(store)
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/journal/analyze") {
    const body = await readJsonBody(req);
    const content = String(body?.content || "").trim();

    if (!content) {
      sendJson(res, 400, { error: "Journal content is required." });
      return;
    }

    const reflection = await safeJournalReflection(content);
    sendJson(res, 200, { reflection: reflection.text, reflectionSource: reflection.source });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    const body = await readJsonBody(req);
    const message = String(body?.message || "").trim();
    const history = Array.isArray(body?.history) ? body.history.slice(-12) : [];
    const mood = String(body?.mood || "");
    const journalEntry = String(body?.journalEntry || "");

    if (!message) {
      sendJson(res, 400, { error: "Message is required." });
      return;
    }

    const store = await readStore();

    let reply;
    let escalated = false;
    let responseSource = "fallback";
    let responseModel = null;
    let responseIssue = null;

    if (containsCrisisLanguage(message)) {
      reply = CRISIS_MESSAGE;
      escalated = true;
      responseSource = "crisis";
    } else if (GEMINI_API_KEY) {
      const result = await safeGeminiReply({ message, history, mood, journalEntry });
      reply = result.text;
      responseSource = result.source;
      responseModel = result.model;
      responseIssue = result.issue || null;
    } else {
      reply = buildFallbackReply(message, mood);
      responseIssue = "Gemini API key is missing.";
    }

    store.chats.push({
      id: crypto.randomUUID(),
      userMessage: message,
      assistantMessage: reply,
      mood,
      createdAt: new Date().toISOString(),
      escalated,
      responseSource,
      responseModel,
      responseIssue
    });

    await writeStore(store);
    sendJson(res, 200, { reply, escalated, responseSource, responseModel, responseIssue });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/resources") {
    sendJson(res, 200, {
      breathing: BREATHING_EXERCISE,
      grounding: GROUNDING_EXERCISE,
      crisis: CRISIS_MESSAGE
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function serveStatic(res, url) {
  const filePath = resolvePublicPath(url.pathname);
  const ext = path.extname(filePath).toLowerCase();

  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeType(ext),
      "Cache-Control": ext ? "public, max-age=300" : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    res.end(data);
  } catch {
    const indexPath = path.join(publicDir, "index.html");
    const html = await fs.readFile(indexPath);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache"
    });
    res.end(html);
  }
}

function resolvePublicPath(requestPath) {
  const normalized = requestPath === "/" ? "/index.html" : requestPath;
  const safePath = path.normalize(normalized).replace(/^(\.\.[/\\])+/, "");
  return path.join(publicDir, safePath);
}

async function readStore() {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_STORE,
      ...parsed,
      moods: Array.isArray(parsed.moods) ? parsed.moods : [],
      journals: Array.isArray(parsed.journals) ? parsed.journals : [],
      chats: Array.isArray(parsed.chats) ? parsed.chats : []
    };
  } catch {
    await writeStore(DEFAULT_STORE);
    return structuredClone(DEFAULT_STORE);
  }
}

async function writeStore(store) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");

  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(payload));
}

function buildDashboardResponse(store) {
  const moods = store.moods.slice(-7);
  const journals = store.journals;
  const chats = store.chats;
  const latestMood = moods.at(-1);
  const latestJournal = journals.at(-1) || null;
  const moodScore = latestMood?.score ?? 0;
  const streak = computeStreak(store.moods);
  const weeklySessions = chats.filter((item) => isWithinDays(item.createdAt, 7)).length;

  return {
    siteName: SITE_NAME,
    geminiConfigured: Boolean(GEMINI_API_KEY),
    geminiModel: GEMINI_MODEL,
    stats: {
      moodScore,
      streak,
      weeklySessions,
      journalCount: journals.length
    },
    moods,
    latestJournal,
    insights: buildInsights(moods, journals, chats),
    supportEmail: SUPPORT_EMAIL
  };
}

function buildInsights(moods, journals, chats) {
  const averageMood = moods.length
    ? (moods.reduce((sum, item) => sum + Number(item.score || 0), 0) / moods.length).toFixed(1)
    : null;

  const insights = [];
  if (averageMood) insights.push(`Your recent average mood score is ${averageMood}/10.`);
  if (journals.length) insights.push("Journaling consistently can help you spot emotional patterns over time.");
  if (chats.length) insights.push("Use chat for short check-ins, then add a journal entry when you want deeper reflection.");
  if (!insights.length) insights.push("Start with a mood check-in to unlock more personalized insights.");
  return insights;
}

function computeStreak(moods) {
  if (!moods.length) return 0;

  const days = [...new Set(moods.map((item) => item.createdAt.slice(0, 10)))].sort().reverse();
  let streak = 0;
  let cursor = new Date();

  for (const day of days) {
    const expected = cursor.toISOString().slice(0, 10);
    if (day === expected) {
      streak += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
      continue;
    }

    if (streak === 0) {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
      if (day === cursor.toISOString().slice(0, 10)) {
        streak += 1;
      }
    }
    break;
  }

  return streak;
}

function isWithinDays(isoDate, days) {
  const then = new Date(isoDate).getTime();
  const now = Date.now();
  return now - then <= days * 24 * 60 * 60 * 1000;
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function buildJournalReflection(content) {
  const lowered = content.toLowerCase();
  const themes = [];
  if (lowered.includes("stress") || lowered.includes("overwhelm")) themes.push("stress");
  if (lowered.includes("anx") || lowered.includes("panic") || lowered.includes("worry")) themes.push("anxiety");
  if (lowered.includes("tired") || lowered.includes("sleep")) themes.push("rest");
  if (lowered.includes("grateful") || lowered.includes("thankful") || lowered.includes("happy")) themes.push("gratitude");

  const line = themes.length
    ? `I noticed themes around ${themes.join(", ")}.`
    : "I noticed thoughtful emotional processing in your writing.";

  return `${line} A gentle next step could be naming one feeling, one need, and one supportive action for tonight.`;
}

function buildFallbackReply(message, mood) {
  const lowered = message.toLowerCase();

  if (containsOutOfScopeRequest(lowered)) {
    return "I'm here specifically for mental wellness support, coping strategies, journaling reflection, and using Serenity's features. If you want, tell me how you're feeling or which exercise would help right now.";
  }

  if (lowered.includes("anx") || lowered.includes("panic") || lowered.includes("worry") || lowered.includes("stress")) {
    return "Anxiety and stress can feel intense. Let's slow it down together: unclench your jaw, relax your shoulders, and take one slow breath. Do you want grounding steps, a short breathing reset, or help naming what is driving the stress?";
  }

  if (lowered.includes("sad") || lowered.includes("down") || lowered.includes("lonely")) {
    return "That sounds really heavy. You do not need to carry it alone in this moment. If you want, we can gently sort through what happened, or keep it simple and focus on one small caring step for today.";
  }

  if (mood) {
    return `Thanks for sharing that while feeling ${mood}. I'm here to support your mental wellness, not judge it. Would it help to talk it through, write a journal reflection, or try a grounding exercise?`;
  }

  return "Thank you for sharing that. I'm here for mental health support, emotional check-ins, journaling reflection, and calming exercises. Tell me what feels hardest right now, and we'll take it one step at a time.";
}

function containsCrisisLanguage(text) {
  const lowered = text.toLowerCase();
  return [
    "suicide",
    "kill myself",
    "want to die",
    "end my life",
    "hurt myself",
    "self harm",
    "self-harm",
    "overdose",
    "can't go on"
  ].some((phrase) => lowered.includes(phrase));
}

function containsOutOfScopeRequest(text) {
  return [
    "write code",
    "weather",
    "stock",
    "crypto",
    "movie",
    "football",
    "politics",
    "shopping"
  ].some((phrase) => text.includes(phrase));
}

async function safeJournalReflection(content) {
  if (!GEMINI_API_KEY) {
    return { text: buildJournalReflection(content), source: "fallback", model: null, issue: "Gemini API key is missing." };
  }

  try {
    const text = await generateJournalReflection(content);
    return { text, source: "gemini", model: GEMINI_MODEL, issue: null };
  } catch (error) {
    return { text: buildJournalReflection(content), source: "fallback", model: null, issue: error.message };
  }
}

async function generateJournalReflection(content) {
  const prompt = [
    "You are Serenity, a compassionate mental wellness assistant.",
    "Analyze the user's journal only in a supportive, non-diagnostic way.",
    "Respond in 3 short sentences maximum.",
    "Reflect emotional themes, validate gently, and suggest one grounded next step.",
    "Do not diagnose, prescribe medication, or claim certainty."
  ].join(" ");

  return generateGeminiText({
    userMessage: `Journal entry:\n${content}`,
    extraInstruction: prompt
  });
}

async function safeGeminiReply({ message, history, mood, journalEntry }) {
  try {
    const text = await generateGeminiReply({ message, history, mood, journalEntry });
    return { text, source: "gemini", model: GEMINI_MODEL, issue: null };
  } catch (error) {
    console.error("Gemini reply failed, using fallback.", error.message);
    return {
      text: buildFallbackReply(message, mood),
      source: "fallback",
      model: null,
      issue: error.message
    };
  }
}

async function generateGeminiReply({ message, history, mood, journalEntry }) {
  const historyText = history
    .map((item) => `${item.role === "assistant" ? "Assistant" : "User"}: ${String(item.content || "")}`)
    .join("\n")
    .slice(-4000);

  const extraInstruction = [
    "You are Serenity, a compassionate mental wellness companion inside a web app.",
    "You must stay on topic: mental health, emotional support, coping skills, mindfulness, journaling reflection, stress, burnout, sleep hygiene, and app-related guidance.",
    "If the user asks for unrelated topics, politely refuse and redirect to mental wellness support.",
    "Never diagnose mental illness, never claim to be a therapist, and never replace professional help.",
    "If the user seems in immediate danger, urge emergency or crisis support immediately.",
    "Keep responses warm, practical, and under 180 words.",
    "When useful, give 2 or 3 concrete coping steps instead of generic reassurance.",
    `Current mood check-in: ${mood || "unknown"}.`,
    journalEntry ? `Recent journal context: ${journalEntry.slice(0, 1000)}` : "No recent journal context."
  ].join(" ");

  return generateGeminiText({
    userMessage: `Conversation so far:\n${historyText}\n\nUser message:\n${message}`,
    extraInstruction
  });
}

async function generateGeminiText({ userMessage, extraInstruction }) {
  let lastError = null;

  for (const model of GEMINI_FALLBACK_MODELS) {
    try {
      return await requestGeminiText({ model, userMessage, extraInstruction });
    } catch (error) {
      lastError = error;
      const retryable = error.status === 429 || error.status === 500 || error.status === 503;
      if (retryable) {
        await delay(600);
        try {
          return await requestGeminiText({ model, userMessage, extraInstruction });
        } catch (retryError) {
          lastError = retryError;
        }
      }
    }
  }

  throw lastError || new Error("Gemini request failed.");
}

async function requestGeminiText({ model, userMessage, extraInstruction }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: extraInstruction }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userMessage }]
        }
      ],
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 320
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`Gemini request failed for ${model}: ${response.status} ${errorText}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text).join("").trim();
  if (!text) {
    throw new Error(`Gemini returned an empty response for ${model}.`);
  }

  return text;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mimeType(ext) {
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".ico": "image/x-icon"
    }[ext] || "application/octet-stream"
  );
}

function loadEnv(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
      const [key, ...rest] = line.split("=");
      const value = rest.join("=").trim();
      if (!process.env[key.trim()]) {
        process.env[key.trim()] = value.replace(/^['"]|['"]$/g, "");
      }
    }
  } catch {
    return;
  }
}
