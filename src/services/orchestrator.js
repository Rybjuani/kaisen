import crypto from "crypto";

import { CHARACTERS, getCharacter } from "../config/characters.js";
import { runtime } from "../config/runtime.js";
import { generateCharacterReply } from "../providers/index.js";
import { buildAgentMessages } from "./prompting.js";

const SIGNAL_GROUPS = runtime.chat.signals;

const CHARACTER_REFERENCE_PATTERNS = CHARACTERS.map((character) => ({
  characterId: character.id,
  explicitAliases: [character.handle.replace("@", "").toLowerCase(), character.id.toLowerCase()],
  naturalAliases: [...new Set([character.name.toLowerCase(), ...(character.aliases || []).map((alias) => alias.toLowerCase())])],
}));

function createRequestError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function clampText(text, maxLength = 4000) {
  return String(text || "").trim().slice(0, maxLength);
}

function countWords(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function includesSignal(text, signals = []) {
  return signals.some((signal) => text.includes(signal));
}

function sanitizeHistoryEntry(entry) {
  const role = entry?.role === "agent" ? "agent" : entry?.role === "user" ? "user" : null;
  const text = clampText(entry?.text, 1200);
  if (!role || !text) return null;

  const speakerId = role === "agent" && typeof entry?.speakerId === "string" ? entry.speakerId.toLowerCase() : null;
  if (role === "agent" && !getCharacter(speakerId)) return null;

  return {
    role,
    speakerId: role === "agent" ? speakerId : null,
    text,
  };
}

function normalizeSilencedAgents(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((item) => String(item || "").toLowerCase()).filter((item) => Boolean(getCharacter(item))))];
}

function extractCharacterReferences(text) {
  const lowered = String(text || "").toLowerCase();
  const explicitMatches = [...lowered.matchAll(/@([a-z0-9_-]+)/g)].map((match) => match[1]);
  const explicit = [];
  const natural = [];

  for (const referenceConfig of CHARACTER_REFERENCE_PATTERNS) {
    if (
      referenceConfig.explicitAliases.some((alias) => explicitMatches.includes(alias))
    ) {
      explicit.push(referenceConfig.characterId);
      continue;
    }

    const matchedNatural = referenceConfig.naturalAliases.some((alias) => {
      const pattern = new RegExp(`\\b${escapeRegExp(alias).replace(/\\ /g, "\\s+")}\\b`, "i");
      return pattern.test(text);
    });

    if (matchedNatural) {
      natural.push(referenceConfig.characterId);
    }
  }

  const all = [...new Set([...explicit, ...natural])];

  return {
    explicit,
    natural: natural.filter((id) => !explicit.includes(id)),
    all,
  };
}

function recentAgentTurns(history) {
  return history.filter((entry) => entry.role === "agent").slice(-10);
}

function countKeywordHits(text, keywords) {
  const lowered = text.toLowerCase();
  return keywords.reduce((count, keyword) => (lowered.includes(keyword) ? count + 1 : count), 0);
}

function buildSceneContext(text, references, history) {
  const lowered = text.toLowerCase();
  const wordCount = countWords(text);
  const recentAgents = recentAgentTurns(history);

  return {
    text,
    lowered,
    wordCount,
    references,
    requestedIds: references.all,
    explicitIds: references.explicit,
    naturalIds: references.natural,
    directReferenceCount: references.all.length,
    solo: includesSignal(lowered, SIGNAL_GROUPS.solo),
    debate: includesSignal(lowered, SIGNAL_GROUPS.debate),
    groupAsked: includesSignal(lowered, SIGNAL_GROUPS.group),
    emotional: includesSignal(lowered, SIGNAL_GROUPS.emotional),
    strategic: includesSignal(lowered, SIGNAL_GROUPS.strategic),
    chaotic: includesSignal(lowered, SIGNAL_GROUPS.chaotic),
    humorous: includesSignal(lowered, SIGNAL_GROUPS.humor),
    shortPing: wordCount <= 8,
    recentAgents,
    lastHistorySpeakerId: recentAgents.at(-1)?.speakerId || null,
  };
}

function determineRoundPlan(context, availableCount) {
  const hardCap = Math.min(runtime.chat.maxRoundTurns, runtime.chat.naturalRound.softMaxMessages, availableCount + 1);

  let minSteps = runtime.chat.naturalRound.minMessages;
  let desiredSteps = 2;

  if (context.solo && context.directReferenceCount <= 1) {
    desiredSteps = 1;
  } else if (context.shortPing && context.directReferenceCount <= 1) {
    desiredSteps = 1;
  } else if (context.debate || context.groupAsked || context.directReferenceCount >= 2) {
    minSteps = 2;
    desiredSteps = 3;
  }

  if (context.wordCount > 28 || context.strategic || context.chaotic) {
    desiredSteps += 1;
  }

  if (context.groupAsked && context.debate) {
    desiredSteps += 1;
  }

  desiredSteps = Math.max(minSteps, Math.min(desiredSteps, hardCap));

  return {
    minSteps,
    desiredSteps,
    hardCap: Math.max(1, Math.min(runtime.chat.maxRoundTurns, hardCap)),
    allowReentry: context.debate || context.directReferenceCount >= 2 || context.wordCount > 22,
  };
}

function baseContextBoost(character, context) {
  let score = 0;

  if (context.explicitIds.includes(character.id)) score += 150;
  if (context.naturalIds.includes(character.id)) score += 95;
  score += countKeywordHits(context.text, character.keywords) * 15;

  if (context.emotional && ["itadori", "megumi", "gojo"].includes(character.id)) score += 18;
  if (context.strategic && ["megumi", "gojo", "sukuna"].includes(character.id)) score += 18;
  if (context.chaotic && ["sukuna", "mahito", "todo"].includes(character.id)) score += 18;
  if (context.humorous && ["gojo", "todo", "mahito"].includes(character.id)) score += 10;

  return score;
}

function scoreOpeningSpeaker({ character, context, history }) {
  const recentAgents = recentAgentTurns(history);
  const recentOccurrences = recentAgents.filter((entry) => entry.speakerId === character.id).length;
  const lastSpeaker = recentAgents.at(-1)?.speakerId || null;

  let score = 12 + baseContextBoost(character, context);
  score += character.openingBias * 20;
  score -= recentOccurrences * 30;
  if (lastSpeaker === character.id) score -= 42;
  if (context.solo && context.requestedIds.includes(character.id)) score += 26;
  if (context.groupAsked && ["gojo", "itadori", "todo"].includes(character.id)) score += 8;
  score += Math.random() * 4;

  return score;
}

function extractNamedCharactersFromText(text) {
  return extractCharacterReferences(text).all;
}

function scoreFollowUpSpeaker({ character, context, roundEntries, history, plan }) {
  const roundOccurrences = roundEntries.filter((entry) => entry.speakerId === character.id).length;
  const lastEntry = roundEntries.at(-1) || null;
  const previousSpeakerId = lastEntry?.speakerId || null;
  const firstSpeakerId = roundEntries[0]?.speakerId || null;
  const namesInLastEntry = lastEntry ? extractNamedCharactersFromText(lastEntry.text) : [];

  let score = 10 + baseContextBoost(character, context);
  score += character.followUpBias * 18;

  if (roundOccurrences === 0) score += 16;
  if (context.requestedIds.includes(character.id) && roundOccurrences === 0) score += 32;
  if (previousSpeakerId && previousSpeakerId !== character.id) {
    if (character.dynamics.provokes.includes(previousSpeakerId)) score += 26;
    if (character.dynamics.backsUp.includes(previousSpeakerId)) score += 16;
    if (namesInLastEntry.includes(character.id)) score += 18;
  }

  if (plan.allowReentry && roundOccurrences === 1 && character.id === firstSpeakerId && roundEntries.length >= 2) {
    score += character.reentryBias * 24;
  }

  if (roundOccurrences >= runtime.chat.naturalRound.maxSpeakerEntriesPerRound) {
    score -= 120;
  } else {
    score -= roundOccurrences * 24;
  }

  if (previousSpeakerId === character.id) score -= 200;
  if (context.lastHistorySpeakerId === character.id) score -= 18;

  score += Math.random() * 4;
  return score;
}

function scoreClosingSpeaker({ character, context, roundEntries, history, plan }) {
  let score = scoreFollowUpSpeaker({ character, context, roundEntries, history, plan });
  score += character.closerBias * 24;

  if (["itadori", "megumi", "gojo"].includes(character.id)) score += 12;
  if (context.debate && ["gojo", "sukuna", "mahito"].includes(character.id)) score += 8;

  return score;
}

function chooseSpeaker({ availableCharacters, blockedIds, scorer }) {
  const ranked = availableCharacters
    .filter((character) => !blockedIds.has(character.id))
    .map((character) => ({
      character,
      score: scorer(character),
    }))
    .sort((left, right) => right.score - left.score);

  return ranked[0] || null;
}

function determinePurpose({ roundEntries, context, plan }) {
  if (roundEntries.length === 0) return "open";
  if (roundEntries.length + 1 >= plan.desiredSteps) return "close";
  if (context.debate || context.directReferenceCount >= 2) return "react";
  if (roundEntries.length === 1 && !context.solo && (context.groupAsked || context.wordCount > 18)) return "react";
  return "close";
}

function pickNextSpeaker({ availableCharacters, blockedIds, context, history, roundEntries, plan }) {
  const purpose = determinePurpose({ roundEntries, context, plan });
  const selection = chooseSpeaker({
    availableCharacters,
    blockedIds,
    scorer: (character) => {
      if (purpose === "open") {
        return scoreOpeningSpeaker({ character, context, history });
      }

      if (purpose === "close") {
        return scoreClosingSpeaker({ character, context, roundEntries, history, plan });
      }

      return scoreFollowUpSpeaker({ character, context, roundEntries, history, plan });
    },
  });

  if (!selection) return null;

  const previousSpeakerId = roundEntries.at(-1)?.speakerId || null;
  const replyToAgentId =
    purpose === "open" || !previousSpeakerId || previousSpeakerId === selection.character.id
      ? null
      : previousSpeakerId;

  return {
    ...selection,
    purpose,
    replyToAgentId,
  };
}

function trimToWordLimit(text, maxWords) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();

  const trimmed = words.slice(0, maxWords).join(" ").trim();
  const sentenceCut = trimmed.match(/^(.+[.!?])(?:\s|$)/);
  return (sentenceCut?.[1] || trimmed).trim();
}

function cleanAgentText(text, character) {
  let normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(new RegExp(`^${character.name}\\s*[:,-]\\s*`, "i"), "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  normalized = trimToWordLimit(normalized, character.maxWords);

  return normalized;
}

function buildTiming({ character, text, index, purpose }) {
  const range = index === 0 ? runtime.chat.initialDelayMs : runtime.chat.betweenDelayMs;
  const baseTotal = Math.round(range.min + Math.random() * (range.max - range.min));
  const purposeAdjustment = purpose === "react" ? -220 : purpose === "close" ? 80 : 0;
  const adjustedTotal = Math.round((baseTotal + purposeAdjustment) * character.delayBias);
  const cappedTotal = Math.max(range.min, Math.min(adjustedTotal, range.max + 400));
  const typingBase = 760 + Math.min(text.length, 200) * 8;
  const typingMs = Math.max(700, Math.min(Math.round(cappedTotal * 0.58), typingBase));
  const thinkingMs = Math.max(520, cappedTotal - typingMs);

  return {
    thinkingMs,
    typingMs,
  };
}

function shouldStopRound({ context, plan, roundEntries, nextCandidateScore, failures }) {
  if (roundEntries.length >= plan.hardCap) return true;
  if (roundEntries.length < plan.minSteps) return false;
  if (failures >= runtime.chat.naturalRound.maxProviderFailuresPerRound && roundEntries.length > 0) return true;
  if (roundEntries.length >= plan.desiredSteps) return true;

  const spokenIds = [...new Set(roundEntries.map((entry) => entry.speakerId))];
  const coveredReferences =
    context.requestedIds.length === 0 ||
    context.requestedIds.every((characterId) => spokenIds.includes(characterId));

  if (context.solo && roundEntries.length >= 1) return true;
  if (context.shortPing && context.directReferenceCount <= 1 && roundEntries.length >= 1) return true;
  if (!context.debate && coveredReferences && roundEntries.length >= 2 && nextCandidateScore < 75) return true;
  if (coveredReferences && roundEntries.length >= 3 && nextCandidateScore < 92) return true;
  if (!coveredReferences && roundEntries.length >= plan.desiredSteps - 1 && nextCandidateScore < 108) return true;

  return false;
}

export function sanitizeChatRequest(body) {
  const text = clampText(body?.text, 4000);
  if (!text) {
    throw createRequestError("El mensaje no puede estar vacio.", 400);
  }

  const history = Array.isArray(body?.history)
    ? body.history.map(sanitizeHistoryEntry).filter(Boolean).slice(-runtime.chat.historyWindow)
    : [];

  return {
    text,
    history,
    silencedAgents: normalizeSilencedAgents(body?.silencedAgents),
  };
}

export async function createRoundtableConversation({ text, history, silencedAgents }) {
  const references = extractCharacterReferences(text);
  const context = buildSceneContext(text, references, history);
  const silenced = new Set(silencedAgents);
  const availableCharacters = CHARACTERS.filter((character) => !silenced.has(character.id));

  if (!availableCharacters.length) {
    throw createRequestError("Todos los personajes estan silenciados. Activa al menos uno.", 400);
  }

  const plan = determineRoundPlan(context, availableCharacters.length);
  const roundId = crypto.randomUUID();
  const roundEntries = [];
  const steps = [];
  const blockedIds = new Set();
  let failures = 0;

  while (steps.length < plan.hardCap) {
    const candidate = pickNextSpeaker({
      availableCharacters,
      blockedIds,
      context,
      history,
      roundEntries,
      plan,
    });

    if (!candidate) break;

    const character = candidate.character;

    try {
      const messages = buildAgentMessages({
        character,
        history,
        roundEntries,
        userText: text,
        references: context.requestedIds,
        turnIndex: steps.length,
        purpose: candidate.purpose,
        replyToAgentId: candidate.replyToAgentId,
        alreadySpoke: roundEntries.some((entry) => entry.speakerId === character.id),
        roundPlan: plan,
      });

      const response = await generateCharacterReply({
        character,
        messages,
      });

      const cleanedText = cleanAgentText(response.text, character);
      if (!cleanedText) {
        blockedIds.add(character.id);
        failures += 1;
        continue;
      }

      const step = {
        id: crypto.randomUUID(),
        agentId: character.id,
        text: cleanedText,
        provider: response.provider,
        model: response.model,
        purpose: candidate.purpose,
        replyToAgentId: candidate.replyToAgentId,
        timing: buildTiming({
          character,
          text: cleanedText,
          index: steps.length,
          purpose: candidate.purpose,
        }),
        fallbackTrace: response.trace,
      };

      steps.push(step);
      roundEntries.push({
        role: "agent",
        speakerId: character.id,
        text: cleanedText,
      });

      const previewCandidate = pickNextSpeaker({
        availableCharacters,
        blockedIds,
        context,
        history,
        roundEntries,
        plan,
      });

      if (
        shouldStopRound({
          context,
          plan,
          roundEntries,
          nextCandidateScore: previewCandidate?.score || 0,
          failures,
        })
      ) {
        break;
      }
    } catch (error) {
      blockedIds.add(character.id);
      failures += 1;

      if (failures >= runtime.chat.naturalRound.maxProviderFailuresPerRound && steps.length > 0) {
        break;
      }

      if (steps.length === 0 && blockedIds.size >= availableCharacters.length) {
        throw error;
      }
    }
  }

  if (!steps.length) {
    const error = new Error("La mesa se quedo en silencio por un momento.");
    error.statusCode = 503;
    throw error;
  }

  return {
    roundId,
    selectedAgentIds: [...new Set(steps.map((step) => step.agentId))],
    queueAgentIds: steps.map((step) => step.agentId),
    references,
    steps,
  };
}
