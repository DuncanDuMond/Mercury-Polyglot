// These are bounded capabilities of one tutor orchestrator, not autonomous
// agents. The contract makes each state mutation and memory scope explicit.
import { RELATIONSHIPS } from "./concept-graph.js";
export const CAPABILITY_CONTRACTS = Object.freeze({
  Mercury: { input: "learner action + active session", output: "learning event + next activity",
    reads: ["session", "language pack"], writes: ["activity status", "learning event"] },
  Moon: { input: "skill + language pack", output: "comprehensible input activity",
    reads: ["curated input"], writes: [] },
  Saturn: { input: "assessed event + prior mastery", output: "scores + next review",
    reads: ["learner skill"], writes: ["learner skill", "learner state"] },
  Mars: { input: "skill + session phase", output: "production, retry, or reuse prompt",
    reads: ["curated scenarios"], writes: [] },
  Emerald: { input: "learner answer + target", output: "score + classified correction",
    reads: ["activity", "language rubric"], writes: [] },
  Copper: { input: "production evidence", output: "production mastery",
    reads: ["production event"], writes: ["learner skill"] },
  Venus: { input: "language pack + learner goal", output: "regional usage context",
    reads: ["register", "culture", "variety"], writes: [] },
  Jupiter: { input: "learner state + available skills", output: "next domain or skill",
    reads: ["learner state", "skill catalog"], writes: [] },
  Janus: { input: "actual learning event + reported source language", output: "directional transfer signal",
    reads: ["learning event", "enrolled languages"], writes: ["transfer signal"] },
});

export function assessComprehension({ activity, answer, explanation }) {
  const selected = Number(answer);
  if (!Number.isInteger(selected) || selected < 0 || selected >= activity.options.length) {
    throw new Error("Choose one of the available answers");
  }
  const correct = selected === activity.correctIndex;
  return {
    score: correct ? 3 : 0,
    correctedAnswer: activity.options[activity.correctIndex],
    explanation,
    errorType: correct ? "none" : "comprehension",
    mistakes: correct ? [] : [{ category: "comprehension", description: "The meaning of the input was missed." }],
    retryPrompt: "Now use the idea in your own sentence.",
    confidence: 1,
    source: "objective",
  };
}

export function deriveTransferSignal({ transferSource, interferenceSource, targetLanguage,
  conceptId, score, evidenceSource, actualOutput = "", enrolledLanguages = [] }) {
  const normalizedAnswer = actualOutput.normalize("NFC").toLocaleLowerCase();
  const containsForm = (form) => {
    const escaped = form.normalize("NFC").toLocaleLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u").test(normalizedAnswer);
  };
  let sourceLanguage = transferSource || interferenceSource;
  let exactInterference = null;
  if (!sourceLanguage && score <= 1) {
    exactInterference = RELATIONSHIPS.find((relation) =>
      relation.targetLanguage === targetLanguage && relation.conceptId === conceptId &&
      enrolledLanguages.includes(relation.sourceLanguage) &&
      relation.sourceForm !== relation.targetForm &&
      containsForm(relation.sourceForm) && !containsForm(relation.targetForm));
    sourceLanguage = exactInterference?.sourceLanguage;
    if (sourceLanguage) interferenceSource = sourceLanguage;
  }
  if (!sourceLanguage) return null;
  const outcome = transferSource ? "helped" : "interfered";
  if (outcome === "helped" && score < 2) return null;
  if (outcome === "interfered" && score > 1) return null;
  const curatedRelation = exactInterference ?? RELATIONSHIPS.find((relation) =>
    relation.sourceLanguage === sourceLanguage && relation.targetLanguage === targetLanguage &&
    relation.conceptId === conceptId);
  return { sourceLanguage, outcome,
    confidence: exactInterference ? 0.9 : evidenceSource === "self_report" ? 0.5 : 0.7,
    basis: exactInterference ? "exact_foreign_form" : "learner_report",
    relationType: curatedRelation?.type ?? "observed",
    relationNote: curatedRelation?.note ?? null };
}
