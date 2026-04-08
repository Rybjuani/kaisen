import { APP_META, CHARACTERS, STATUS_COPY, getCharacterMeta } from "/shared/kaisen-config.js";

const STORAGE_KEYS = {
  silencedAgents: "kaisen_silenced_agents",
};

const DOM = {
  rosterStrip: document.getElementById("roster-strip"),
  conversation: document.getElementById("conversation"),
  typingZone: document.getElementById("typing-zone"),
  composer: document.getElementById("composer"),
  input: document.getElementById("composer-input"),
  sendButton: document.getElementById("send-button"),
  stopRoundButton: document.getElementById("stop-round-button"),
  topbarStatus: document.getElementById("topbar-status"),
};

const state = {
  messages: [],
  silencedAgents: new Set(loadSilencedAgents()),
  statuses: Object.fromEntries(CHARACTERS.map((character) => [character.id, "active"])),
  activeRound: null,
};

function loadSilencedAgents() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEYS.silencedAgents) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function persistSilencedAgents() {
  localStorage.setItem(STORAGE_KEYS.silencedAgents, JSON.stringify([...state.silencedAgents]));
}

function setRoundUiState(isActive) {
  DOM.stopRoundButton.hidden = !isActive;
  DOM.sendButton.textContent = "Enviar";
}

function setTopbarStatus(text, tone = "ready") {
  DOM.topbarStatus.textContent = text;
  DOM.topbarStatus.dataset.tone = tone;
}

function autosizeInput() {
  DOM.input.style.height = "0px";
  DOM.input.style.height = `${Math.min(DOM.input.scrollHeight, 180)}px`;
}

function scrollConversationToBottom(smooth = true) {
  DOM.conversation.scrollTo({
    top: DOM.conversation.scrollHeight,
    behavior: smooth ? "smooth" : "auto",
  });
}

function createAvatar(character, sizeClass) {
  const avatar = document.createElement("div");
  avatar.className = `avatar ${sizeClass}`;
  avatar.style.setProperty("--agent-soft", character.accentSoft);

  const image = document.createElement("img");
  image.src = character.avatar;
  image.alt = character.name;
  image.loading = "lazy";
  image.decoding = "async";
  image.addEventListener("error", () => {
    avatar.classList.add("is-fallback");
  });

  const fallback = document.createElement("span");
  fallback.textContent = character.fallbackInitials;

  avatar.append(image, fallback);
  return avatar;
}

function updateRosterStatuses() {
  for (const chip of DOM.rosterStrip.querySelectorAll(".roster-chip")) {
    const characterId = chip.dataset.agentId;
    const status = state.silencedAgents.has(characterId) ? "silenced" : state.statuses[characterId] || "active";
    const statusNode = chip.querySelector(".roster-chip-status");

    statusNode.textContent = STATUS_COPY[status];
    statusNode.dataset.state = status;
    chip.dataset.state = status;
    chip.title =
      status === "silenced"
        ? `Reactivar a ${getCharacterMeta(characterId).name}`
        : `Silenciar a ${getCharacterMeta(characterId).name}`;
  }
}

function renderRoster() {
  DOM.rosterStrip.innerHTML = "";

  for (const character of CHARACTERS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "roster-chip";
    chip.dataset.agentId = character.id;
    chip.dataset.action = "toggle-silence";
    chip.style.setProperty("--agent-accent", character.accent);
    chip.style.setProperty("--agent-glow", character.accentGlow);

    const info = document.createElement("div");
    info.className = "roster-chip-copy";

    const name = document.createElement("strong");
    name.textContent = character.name;

    const status = document.createElement("span");
    status.className = "roster-chip-status";

    info.append(name, status);
    chip.append(createAvatar(character, "avatar--roster"), info);
    DOM.rosterStrip.append(chip);
  }

  updateRosterStatuses();
}

function appendMessage(message) {
  state.messages.push(message);

  const entry = document.createElement("article");
  entry.className = `message message--${message.role}`;

  if (message.role === "agent") {
    const character = getCharacterMeta(message.speakerId);
    entry.style.setProperty("--agent-accent", character.accent);
    entry.append(createAvatar(character, "avatar--message"));

    const card = document.createElement("div");
    card.className = "message-card";

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const name = document.createElement("span");
    name.className = "message-name";
    name.textContent = character.name;

    meta.append(name);

    if (message.replyToAgentId) {
      const replyTarget = getCharacterMeta(message.replyToAgentId);
      if (replyTarget) {
        const replyTag = document.createElement("span");
        replyTag.className = "message-reply";
        replyTag.textContent = `a ${replyTarget.name}`;
        meta.append(replyTag);
      }
    }

    const body = document.createElement("div");
    body.className = "message-body";
    body.textContent = message.text;

    card.append(meta, body);
    entry.append(card);
  } else {
    const card = document.createElement("div");
    card.className = "message-card";

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const name = document.createElement("span");
    name.className = "message-name";
    name.textContent = message.role === "user" ? "Tu" : "Mesa";
    meta.append(name);

    const body = document.createElement("div");
    body.className = "message-body";
    body.textContent = message.text;

    card.append(meta, body);
    entry.append(card);
  }

  DOM.conversation.append(entry);
  scrollConversationToBottom();
}

function resetStatuses() {
  for (const character of CHARACTERS) {
    state.statuses[character.id] = state.silencedAgents.has(character.id) ? "silenced" : "active";
  }

  updateRosterStatuses();
}

function markRoundStatuses(pendingQueue, activeAgentId = null) {
  for (const character of CHARACTERS) {
    if (state.silencedAgents.has(character.id)) {
      state.statuses[character.id] = "silenced";
      continue;
    }

    if (character.id === activeAgentId) {
      state.statuses[character.id] = "thinking";
      continue;
    }

    if (pendingQueue.includes(character.id)) {
      state.statuses[character.id] = "waiting";
      continue;
    }

    state.statuses[character.id] = "active";
  }

  updateRosterStatuses();
}

function clearTypingIndicator() {
  DOM.typingZone.innerHTML = "";
}

function showTypingIndicator(characterId) {
  const character = getCharacterMeta(characterId);
  DOM.typingZone.innerHTML = "";

  const entry = document.createElement("div");
  entry.className = "typing-entry";
  entry.style.setProperty("--agent-accent", character.accent);

  const copy = document.createElement("div");
  copy.className = "typing-copy";

  const name = document.createElement("strong");
  name.textContent = character.name;

  const label = document.createElement("span");
  label.textContent = "esta escribiendo";

  const dots = document.createElement("div");
  dots.className = "typing-dots";
  dots.innerHTML = "<i></i><i></i><i></i>";

  entry.append(createAvatar(character, "avatar--typing"), copy, dots);
  copy.append(name, label);

  DOM.typingZone.append(entry);
  scrollConversationToBottom();
}

function delayForRound(ms, token) {
  return new Promise((resolve, reject) => {
    if (!state.activeRound || state.activeRound.token !== token || state.activeRound.cancelled) {
      reject(new Error("ROUND_CANCELLED"));
      return;
    }

    const timeoutId = window.setTimeout(() => {
      state.activeRound?.timers.delete(timeoutId);
      resolve();
    }, ms);

    state.activeRound.timers.add(timeoutId);
  });
}

function cancelRound(reason = "manual") {
  if (!state.activeRound) return;

  state.activeRound.cancelled = true;
  state.activeRound.controller.abort();

  for (const timeoutId of state.activeRound.timers) {
    clearTimeout(timeoutId);
  }

  clearTypingIndicator();
  state.activeRound = null;
  setRoundUiState(false);
  setTopbarStatus(reason === "manual" ? "Ronda cortada" : "Mesa lista", "ready");
  resetStatuses();
}

function buildHistoryPayload() {
  return state.messages
    .filter((message) => message.role === "user" || message.role === "agent")
    .slice(-20)
    .map((message) => ({
      role: message.role,
      speakerId: message.speakerId || null,
      text: message.text,
    }));
}

async function playRound(round, token) {
  const pendingQueue = [...(round.queueAgentIds || round.selectedAgentIds || [])];
  markRoundStatuses(pendingQueue, pendingQueue[0] || null);

  for (const step of round.steps) {
    if (!state.activeRound || state.activeRound.token !== token || state.activeRound.cancelled) {
      return;
    }

    if (state.silencedAgents.has(step.agentId)) {
      const skippedIndex = pendingQueue.indexOf(step.agentId);
      if (skippedIndex >= 0) pendingQueue.splice(skippedIndex, 1);
      continue;
    }

    markRoundStatuses(pendingQueue, step.agentId);
    setTopbarStatus(`${getCharacterMeta(step.agentId).name} entra a la charla`, "busy");

    await delayForRound(step.timing.thinkingMs, token);
    showTypingIndicator(step.agentId);
    setTopbarStatus(`${getCharacterMeta(step.agentId).name} escribe`, "busy");

    await delayForRound(step.timing.typingMs, token);
    clearTypingIndicator();

    appendMessage({
      id: step.id,
      role: "agent",
      speakerId: step.agentId,
      replyToAgentId: step.replyToAgentId || null,
      text: step.text,
    });

    const completedIndex = pendingQueue.indexOf(step.agentId);
    if (completedIndex >= 0) pendingQueue.splice(completedIndex, 1);
    markRoundStatuses(pendingQueue, pendingQueue[0] || null);
  }
}

async function submitMessage(text) {
  if (state.activeRound) {
    cancelRound("superseded");
  }

  appendMessage({
    id: crypto.randomUUID(),
    role: "user",
    text,
  });

  setRoundUiState(true);
  setTopbarStatus("La mesa se acomoda", "busy");

  const token = crypto.randomUUID();
  const controller = new AbortController();
  state.activeRound = {
    token,
    controller,
    cancelled: false,
    timers: new Set(),
  };

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        history: buildHistoryPayload(),
        silencedAgents: [...state.silencedAgents],
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "La mesa se quedo callada por un momento.");
    }

    if (!state.activeRound || state.activeRound.token !== token || state.activeRound.cancelled) {
      return;
    }

    await playRound(payload, token);
  } catch (error) {
    if (error.name !== "AbortError" && error.message !== "ROUND_CANCELLED") {
      appendMessage({
        id: crypto.randomUUID(),
        role: "system",
        text: "La mesa se quedo en silencio un segundo. Intenta de nuevo.",
      });
      setTopbarStatus("La mesa perdio el hilo", "alert");
    }
  } finally {
    if (state.activeRound?.token === token) {
      clearTypingIndicator();
      state.activeRound = null;
      setRoundUiState(false);
      setTopbarStatus("Mesa lista", "ready");
      resetStatuses();
    }
  }
}

function handleRosterClick(event) {
  const button = event.target.closest("[data-action='toggle-silence']");
  if (!button) return;

  const characterId = button.dataset.agentId;
  if (!characterId) return;

  if (state.silencedAgents.has(characterId)) {
    state.silencedAgents.delete(characterId);
  } else {
    state.silencedAgents.add(characterId);
  }

  persistSilencedAgents();
  updateRosterStatuses();
}

function bindEvents() {
  DOM.input.placeholder = APP_META.promptPlaceholder;
  DOM.input.addEventListener("input", autosizeInput);

  DOM.composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = DOM.input.value.trim();
    if (!text) return;

    DOM.input.value = "";
    autosizeInput();
    await submitMessage(text);
  });

  DOM.input.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();

    const text = DOM.input.value.trim();
    if (!text) return;

    DOM.input.value = "";
    autosizeInput();
    await submitMessage(text);
  });

  DOM.stopRoundButton.addEventListener("click", () => {
    cancelRound("manual");
  });

  DOM.rosterStrip.addEventListener("click", handleRosterClick);
}

function bootstrap() {
  document.title = APP_META.title;
  renderRoster();
  bindEvents();
  autosizeInput();
  resetStatuses();
  setRoundUiState(false);
  setTopbarStatus("Mesa lista", "ready");

  appendMessage({
    id: crypto.randomUUID(),
    role: "system",
    text: "La mesa ya estaba ahi. Entra cuando quieras; nombrarlos basta.",
  });
}

bootstrap();
