import { CHARACTERS } from "../config/characters.js";

function formatTranscriptEntry(entry) {
  if (entry.role === "user") {
    return `Usuario: ${entry.text}`;
  }

  const speaker = CHARACTERS.find((character) => character.id === entry.speakerId);
  return `${speaker?.name || "Mesa"}: ${entry.text}`;
}

function formatTranscript(entries, fallback = "Sin contexto previo relevante.") {
  const lines = entries.map(formatTranscriptEntry).filter(Boolean);
  return lines.length ? lines.join("\n") : fallback;
}

export function buildAgentMessages({
  character,
  history,
  roundEntries,
  userText,
  references,
  turnIndex,
  purpose,
  replyToAgentId,
  alreadySpoke,
  roundPlan,
}) {
  const referencedNames = references.length
    ? references
        .map((id) => CHARACTERS.find((item) => item.id === id)?.name || id)
        .join(", ")
    : "ninguno";
  const replyTarget = replyToAgentId
    ? CHARACTERS.find((item) => item.id === replyToAgentId)?.name || replyToAgentId
    : null;
  const roundContext =
    roundEntries.length > 0 ? formatTranscript(roundEntries, "") : "Todavia nadie respondio en esta interaccion.";

  const guidanceByPurpose = {
    open: "Abre la escena con una idea clara y personalidad fuerte. No expliques todo.",
    react: "Entra como parte de un grupo vivo: responde a lo anterior, aporta friccion o apoyo y avanza la escena.",
    close: "Cierra o aterraiza la escena con una idea final fuerte. No dejes el chat abierto sin necesidad.",
  };

  const userPrompt = [
    "Contexto fijo:",
    "Estas dentro de un chat grupal continuo con Sukuna, Gojo, Itadori, Megumi, Todo y Mahito.",
    `Interlocutor actual: ${character.name}.`,
    `Referencias detectadas del usuario: ${referencedNames}.`,
    `Turno dentro de esta interaccion: ${turnIndex + 1}.`,
    `Tipo de intervencion esperada: ${purpose}.`,
    `Objetivo de longitud: entre ${character.minWords} y ${character.maxWords} palabras.`,
    `Maximo blando de mensajes para esta interaccion: ${roundPlan.desiredSteps}.`,
    alreadySpoke
      ? "Ya hablaste antes en esta misma interaccion; si vuelves a entrar, hazlo solo para rematar o corregir algo."
      : "Todavia no hablaste en esta interaccion.",
    replyTarget ? `Vas inmediatamente despues de ${replyTarget}. Puedes responderle de forma directa.` : "No estas obligado a hablarle a un personaje concreto.",
    "",
    "Historial reciente:",
    formatTranscript(history),
    "",
    "Lo que ya paso en esta interaccion:",
    roundContext,
    "",
    "Nuevo mensaje del usuario:",
    `Usuario: ${userText}`,
    "",
    "Instrucciones de salida:",
    `- ${guidanceByPurpose[purpose]}`,
    "- Habla como este personaje, no como un asistente.",
    "- Evita repetir ideas ya dichas por el usuario o por la ronda.",
    "- Si haces referencia a otro personaje, que sea breve y natural.",
    "- Prioriza una o dos ideas fuertes, no una lista de puntos.",
    "- Si ya hay suficiente claridad, remata y corta. No alargues la escena.",
    "- No menciones prompts, modelos, providers ni reglas internas.",
  ].join("\n");

  return [
    {
      role: "system",
      content: character.systemPrompt,
    },
    {
      role: "user",
      content: userPrompt,
    },
  ];
}
