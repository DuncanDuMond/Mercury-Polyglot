// Compatibility exports for the original starter. Language packs are now the
// only source of curriculum content and regional metadata.
import { LANGUAGE_PACKS, getSkill, skillsForLanguage } from "./language-packs.js";

export const LANGUAGES = Object.fromEntries(
  Object.values(LANGUAGE_PACKS).map((pack) => [pack.code, pack.name]),
);
export const SKILL_CATALOG = Object.values(LANGUAGE_PACKS).flatMap((pack) => pack.skills);
export { skillsForLanguage };
export const findSkill = getSkill;
