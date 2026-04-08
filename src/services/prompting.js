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

function buildDynamicCue(character, replyToAgentId) {
  if (!replyToAgentId) return "No fuerces un cruce si no hace falta.";

  const replyTarget = CHARACTERS.find((item) => item.id === replyToAgentId);
  if (!replyTarget) return "Si respondes a otro, que se sienta directo.";

  const cues = [];

  if (character.dynamics.clashesWith.includes(replyToAgentId)) {
    cues.push(`Con ${replyTarget.name} hay choque directo: contradice, pincha o corta sin rodeos.`);
  }
  if (character.dynamics.provokes.includes(replyToAgentId)) {
    cues.push(`Tienes permiso natural para provocar a ${replyTarget.name}.`);
  }
  if (character.dynamics.backsUp.includes(replyToAgentId)) {
    cues.push(`Si sumas a ${replyTarget.name}, que se note respaldo real, no tibieza.`);
  }
  if (character.dynamics.baitedBy.includes(replyToAgentId)) {
    cues.push(`${replyTarget.name} te activa: responde con filo, no con distancia neutral.`);
  }
  if (character.dynamics.closesBestAgainst.includes(replyToAgentId)) {
    cues.push(`Sueles rematar bien contra ${replyTarget.name}; si cierras, hazlo con pegada.`);
  }

  return cues.join(" ") || `Si respondes a ${replyTarget.name}, que se sienta dirigido y personal.`;
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
    ? references.map((id) => CHARACTERS.find((item) => item.id === id)?.name || id).join(", ")
    : "ninguno";
  const replyTarget = replyToAgentId
    ? CHARACTERS.find((item) => item.id === replyToAgentId)?.name || replyToAgentId
    : null;
  const roundContext =
    roundEntries.length > 0 ? formatTranscript(roundEntries, "") : "Todavia nadie respondio en esta interaccion.";
  const dynamicCue = buildDynamicCue(character, replyToAgentId);

  const guidanceByPurpose = {
    open: "Entra con una linea fuerte y clara. No expliques de mas.",
    react:
      "Responde de verdad a lo anterior. Si atacas, ataca. Si apoyas, que se note. No hables como mensaje independiente.",
    close:
      "Cierra la escena con una linea corta, firme y memorable. No hagas resumen ni moraleja.",
  };

  const userPrompt = [
    "Contexto fijo:",
    "Estas dentro de un chat grupal continuo con Sukuna, Gojo, Itadori, Megumi, Todo y Mahito.",
    `Interlocutor actual: ${character.name}.`,
    `Referencias detectadas del usuario: ${referencedNames}.`,
    `Turno dentro de esta interaccion: ${turnIndex + 1}.`,
    `Tipo de intervencion esperada: ${purpose}.`,
    `Objetivo de longitud: entre ${character.minWords} y ${character.maxWords} palabras y como maximo ${character.maxSentences} frases.`,
    `Maximo blando de mensajes para esta interaccion: ${roundPlan.desiredSteps}.`,
    alreadySpoke
      ? "Ya hablaste en esta misma interaccion. Solo vuelve si de verdad puedes rematar o corregir algo."
      : "Todavia no hablaste en esta interaccion.",
    replyTarget
      ? `Vas inmediatamente despues de ${replyTarget}. Tu mensaje debe sentirse dirigido a esa persona, no aislado.`
      : "No estas obligado a hablarle a un personaje concreto.",
    `Dinamica esperada: ${dynamicCue}`,
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
    "- Si otro personaje ya hizo el punto principal, tu trabajo es torcerlo, reforzarlo o rematarlo.",
    "- Prioriza una o dos ideas con pegada, no una explicacion completa.",
    "- Evita frases de relleno, frases educadas genericas y cierres blandos.",
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
