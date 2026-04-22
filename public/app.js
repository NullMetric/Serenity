const moods = [
  { label: "Calm", emoji: "😌", score: 8 },
  { label: "Happy", emoji: "😊", score: 9 },
  { label: "Anxious", emoji: "😰", score: 4 },
  { label: "Sad", emoji: "😔", score: 3 },
  { label: "Frustrated", emoji: "😤", score: 4 },
  { label: "Numb", emoji: "😶", score: 2 },
  { label: "Energized", emoji: "⚡", score: 8 }
];

const state = {
  currentMood: null,
  dashboard: null,
  journalText: "",
  resources: null,
  chatHistory: [],
  breathingActive: false,
  breathingTimer: null,
  lastResponseSource: null,
  lastResponseIssue: null
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindNavigation();
  bindActions();
  renderMoodButtons();
  seedWelcomeMessages();
  updateGreeting();
  await loadBootstrap();
  await loadResources();
}

function bindNavigation() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => showSection(button.dataset.section));
  });
}

function bindActions() {
  document.getElementById("start-session-btn").addEventListener("click", () => {
    showSection("chat");
    document.getElementById("chat-input-full").focus();
  });

  document.getElementById("open-journal-btn").addEventListener("click", () => showSection("journal"));
  document.getElementById("refresh-insights-btn").addEventListener("click", refreshInsights);
  document.getElementById("save-journal-btn").addEventListener("click", saveJournal);
  document.getElementById("analyze-journal-btn").addEventListener("click", analyzeJournal);
  document.getElementById("breathe-btn").addEventListener("click", toggleBreathing);

  document.querySelectorAll(".send-btn").forEach((button) => {
    button.addEventListener("click", () => sendMessage(button.dataset.chat));
  });

  document.querySelectorAll(".chat-input").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const target = input.id.endsWith("main") ? "main" : "full";
        sendMessage(target);
      }
    });
  });

  document.getElementById("journal-text").addEventListener("input", (event) => {
    state.journalText = event.target.value;
    updateJournalHint();
  });

  document.querySelectorAll("[data-resource]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.resource;
      if (target === "journal") showSection("journal");
      if (target === "breathing" || target === "grounding") showSection("exercises");
    });
  });
}

function showSection(name) {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.section === name);
  });

  ["dashboard", "chat", "journal", "exercises", "about"].forEach((section) => {
    document.getElementById(`section-${section}`).hidden = section !== name;
  });

  const titles = {
    dashboard: ["Good day", "How are you feeling right now?"],
    chat: ["AI Support Session", "Talk through what feels heavy, tense, or confusing."],
    journal: ["Daily Journal", "Give your thoughts a place to land."],
    exercises: ["Calming Exercises", "Use breathing and grounding to reset gently."],
    about: ["Launch Notes", "Everything needed to run and deploy this MVP."]
  };

  const [title, subtitle] = titles[name] || titles.dashboard;
  document.getElementById("page-title").textContent = name === "dashboard" ? buildGreeting() : title;
  document.getElementById("page-sub").textContent = subtitle;
}

function buildGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function updateGreeting() {
  document.getElementById("page-title").textContent = buildGreeting();
}

function renderMoodButtons() {
  const container = document.getElementById("mood-buttons");
  container.innerHTML = moods
    .map(
      (item) => `<button class="mood-btn" data-mood="${item.label}" data-score="${item.score}">${item.emoji} ${item.label}</button>`
    )
    .join("");

  container.querySelectorAll(".mood-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      container.querySelectorAll(".mood-btn").forEach((btn) => btn.classList.remove("selected"));
      button.classList.add("selected");
      state.currentMood = button.dataset.mood;
      await saveMood(button.dataset.mood, Number(button.dataset.score));
      addAssistantMessage("main", `I hear that you're feeling ${button.dataset.mood.toLowerCase()}. Would talking it through help, or would you prefer a grounding exercise first?`);
    });
  });
}

function seedWelcomeMessages() {
  addAssistantMessage("main", "Hello, I'm Serenity. I'm here for mental wellness support, journaling reflection, coping strategies, and gentle check-ins.");
  addAssistantMessage("full", "Welcome to your support session. Share what feels hard, tense, confusing, or emotionally heavy, and we'll work through it one step at a time.");
}

async function loadBootstrap() {
  setStatus("loading", "Checking AI connection...");
  const [health, dashboard] = await Promise.all([api("/api/health"), api("/api/bootstrap")]);
  state.dashboard = dashboard;
  const modelLabel = health.geminiConfigured ? `Gemini ready: ${health.geminiModel}` : "Gemini key missing";
  setStatus(health.geminiConfigured ? "connected" : "disconnected", modelLabel);
  hydrateJournal(dashboard.latestJournal);
  renderDashboard(dashboard);
}

async function loadResources() {
  state.resources = await api("/api/resources");
  document.getElementById("grounding-list").innerHTML = state.resources.grounding
    .map((step) => `<div class="exercise-step">${escapeHtml(step)}</div>`)
    .join("");
}

function hydrateJournal(latestJournal) {
  const journalInput = document.getElementById("journal-text");
  if (!latestJournal) {
    updateJournalHint();
    return;
  }

  state.journalText = latestJournal.content || "";
  journalInput.value = state.journalText;
  updateJournalHint(`Latest saved entry restored from ${formatDate(latestJournal.createdAt)}.`);
  if (latestJournal.reflection) {
    renderJournalAnalysis(latestJournal.reflection, latestJournal.reflectionSource || "saved");
  }
}

function renderDashboard(dashboard) {
  if (!dashboard) return;

  document.getElementById("stat-mood-score").textContent = Number(dashboard.stats.moodScore || 0).toFixed(1);
  document.getElementById("stat-streak").textContent = dashboard.stats.streak || 0;
  document.getElementById("stat-sessions").textContent = dashboard.stats.weeklySessions || 0;
  document.getElementById("ai-insights").innerHTML = dashboard.insights.map((line) => `<p>${escapeHtml(line)}</p>`).join("");

  const pills = [];
  if (dashboard.stats.streak) pills.push("Consistent check-ins");
  if (dashboard.latestJournal) pills.push("Journal activity saved");
  if (dashboard.geminiConfigured) pills.push("AI support live");
  if (!pills.length) pills.push("Start with your first check-in");

  document.getElementById("trend-pills").innerHTML = pills.map((pill) => `<span class="insight-pill">${escapeHtml(pill)}</span>`).join("");
  renderMoodChart(dashboard.moods || []);
}

function renderMoodChart(entries) {
  const chart = document.getElementById("mood-chart");
  const dayLabels = document.getElementById("chart-days");
  const lastSeven = [...entries];
  const padded = Array.from({ length: 7 }, (_, index) => lastSeven[lastSeven.length - 7 + index] || null);

  chart.innerHTML = padded
    .map((entry, index) => {
      const score = entry?.score || 0;
      const height = Math.max(score * 10, 14);
      return `<div class="chart-bar ${index === padded.length - 1 ? "today" : ""}" style="height:${height}px" title="${entry ? `${entry.label} (${score}/10)` : "No entry"}"></div>`;
    })
    .join("");

  dayLabels.innerHTML = padded
    .map((entry) => {
      const date = entry?.createdAt ? new Date(entry.createdAt) : null;
      const label = date ? date.toLocaleDateString(undefined, { weekday: "short" }) : "-";
      return `<div class="chart-day">${label}</div>`;
    })
    .join("");
}

async function saveMood(label, score) {
  const response = await api("/api/moods", {
    method: "POST",
    body: JSON.stringify({ label, score })
  });

  state.dashboard = response.dashboard;
  renderDashboard(response.dashboard);
}

async function saveJournal() {
  const content = document.getElementById("journal-text").value.trim();
  if (!content) return;

  const response = await api("/api/journal", {
    method: "POST",
    body: JSON.stringify({ content })
  });

  state.dashboard = response.dashboard;
  state.journalText = content;
  renderDashboard(response.dashboard);
  renderJournalAnalysis(response.reflection, response.reflectionSource || "saved");
  updateJournalHint(`Entry saved successfully at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`);
}

async function analyzeJournal() {
  const content = document.getElementById("journal-text").value.trim();
  if (!content) return;

  renderJournalAnalysis("Analyzing your reflection...", "working");
  const response = await api("/api/journal/analyze", {
    method: "POST",
    body: JSON.stringify({ content })
  });
  renderJournalAnalysis(response.reflection, response.reflectionSource || "analysis");
}

function renderJournalAnalysis(text, source = "analysis") {
  const box = document.getElementById("journal-analysis");
  box.hidden = false;
  const label = source === "gemini" ? "AI reflection" : source === "fallback" ? "Guided reflection" : "Reflection";
  box.innerHTML = `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(text)}`;
}

async function sendMessage(target) {
  const input = document.getElementById(target === "main" ? "chat-input-main" : "chat-input-full");
  const text = input.value.trim();
  if (!text) return;

  addUserMessage(target, text);
  input.value = "";
  const typingId = addTypingIndicator(target);

  try {
    const response = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        message: text,
        mood: state.currentMood || "",
        journalEntry: document.getElementById("journal-text").value.trim(),
        history: state.chatHistory
      })
    });

    state.chatHistory.push({ role: "user", content: text }, { role: "assistant", content: response.reply });
    state.lastResponseSource = response.responseSource || null;
    state.lastResponseIssue = response.responseIssue || null;
    removeTypingIndicator(typingId);
    addAssistantMessage(target, response.reply);
    document.getElementById("crisis-banner").hidden = !response.escalated;

    if (response.responseSource === "gemini") {
      setStatus("connected", `Answered by ${response.responseModel || "Gemini"}`);
    } else if (response.responseSource === "fallback") {
      setStatus("loading", "Using backup response while Gemini is busy");
    }
  } catch (error) {
    removeTypingIndicator(typingId);
    addAssistantMessage(target, "I hit a connection problem just now. Please try again in a moment.");
    setStatus("disconnected", "Connection problem");
  }
}

function addUserMessage(target, text) {
  renderMessage(target, { role: "user", label: "You", text });
}

function addAssistantMessage(target, text) {
  renderMessage(target, { role: "assistant", label: "Serenity", text });
}

function renderMessage(target, { role, label, text }) {
  const container = document.getElementById(target === "main" ? "chat-messages-main" : "chat-messages-full");
  const wrapper = document.createElement("div");
  wrapper.className = `msg ${role === "user" ? "user" : "ai"}`;
  wrapper.innerHTML = `
    <div class="msg-avatar ${role === "user" ? "user" : "ai"}">${role === "user" ? "You" : "AI"}</div>
    <div class="msg-bubble">
      ${role === "assistant" ? `<div class="msg-label">${escapeHtml(label)}</div>` : ""}
      <div class="msg-content">${escapeHtml(text).replace(/\n/g, "<br>")}</div>
    </div>
  `;
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
}

function addTypingIndicator(target) {
  const container = document.getElementById(target === "main" ? "chat-messages-main" : "chat-messages-full");
  const wrapper = document.createElement("div");
  const id = `typing-${Date.now()}`;
  wrapper.className = "msg ai";
  wrapper.id = id;
  wrapper.innerHTML = `
    <div class="msg-avatar ai">AI</div>
    <div class="msg-bubble">
      <div class="msg-content"><div class="typing-dots"><span></span><span></span><span></span></div></div>
    </div>
  `;
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
  return id;
}

function removeTypingIndicator(id) {
  document.getElementById(id)?.remove();
}

function toggleBreathing() {
  if (state.breathingActive) {
    state.breathingActive = false;
    clearTimeout(state.breathingTimer);
    resetBreathingUi();
    return;
  }

  state.breathingActive = true;
  document.getElementById("breathe-btn").textContent = "Stop";
  breathingCycle();
}

function breathingCycle() {
  if (!state.breathingActive) return;
  const ring = document.getElementById("breathe-ring");
  const text = document.getElementById("breathe-text");
  const caption = document.getElementById("breathe-caption");

  ring.className = "breathe-ring inhale";
  text.textContent = "Inhale";
  caption.textContent = "4 seconds - breathe in slowly";

  state.breathingTimer = window.setTimeout(() => {
    if (!state.breathingActive) return;
    ring.className = "breathe-ring";
    text.textContent = "Hold";
    caption.textContent = "7 seconds - hold gently";

    state.breathingTimer = window.setTimeout(() => {
      if (!state.breathingActive) return;
      ring.className = "breathe-ring exhale";
      text.textContent = "Exhale";
      caption.textContent = "8 seconds - release slowly";

      state.breathingTimer = window.setTimeout(() => {
        if (!state.breathingActive) return;
        ring.className = "breathe-ring";
        breathingCycle();
      }, 8000);
    }, 7000);
  }, 4000);
}

function resetBreathingUi() {
  document.getElementById("breathe-ring").className = "breathe-ring";
  document.getElementById("breathe-text").textContent = "Ready";
  document.getElementById("breathe-caption").textContent = "Click start to begin.";
  document.getElementById("breathe-btn").textContent = "Start";
}

function refreshInsights() {
  renderDashboard(state.dashboard);
}

function updateJournalHint(customText = "") {
  const count = countWords(state.journalText);
  document.getElementById("journal-hint").textContent = customText || (count
    ? `${count} ${count === 1 ? "word" : "words"}`
    : "Start writing to see your word count.");
}

function setStatus(kind, text) {
  const dot = document.getElementById("status-dot");
  dot.className = `status-dot ${kind}`;
  document.getElementById("sidebar-model-sub").textContent = text;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Request failed");
  }

  return response.json();
}

function countWords(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
}

function formatDate(isoString) {
  if (!isoString) return "";
  return new Date(isoString).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
