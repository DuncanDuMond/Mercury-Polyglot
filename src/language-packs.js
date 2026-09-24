// Curated starter content. Learning state and scheduling belong to the tutor engine.
// A pack describes a regional language variety and supplies observable tasks.
const SPEAK_EXAMPLES = {
  "pt-BR": {
    form: "falar",
    text: "Quero falar com a atendente.",
    prompt: "At a shop in Brazil, say you want to speak with the attendant.",
    answer: "Quero falar com a atendente.",
    reusePrompt: "Later, say you want to speak with a friend today.",
    reuseAnswer: "Quero falar com uma amiga hoje.",
  },
  "es-419": {
    form: "hablar",
    text: "Quiero hablar con la bibliotecaria.",
    prompt: "At a library, say in Spanish that you want to speak with the librarian.",
    answer: "Quiero hablar con la bibliotecaria.",
    reusePrompt: "Later, say you want to speak with a friend tomorrow.",
    reuseAnswer: "Quiero hablar con un amigo mañana.",
  },
  "it-IT": {
    form: "parlare",
    text: "Vorrei parlare con il cameriere.",
    prompt: "At a restaurant in Italy, say politely that you would like to speak with the waiter.",
    answer: "Vorrei parlare con il cameriere.",
    reusePrompt: "Later, say you would like to speak with a friend.",
    reuseAnswer: "Vorrei parlare con un'amica.",
  },
  "fr-FR": {
    form: "parler",
    text: "Je voudrais parler à la bibliothécaire.",
    prompt: "At a library, say politely in French that you would like to speak to the librarian.",
    answer: "Je voudrais parler à la bibliothécaire.",
    reusePrompt: "Later, say you would like to speak to a friend tomorrow.",
    reuseAnswer: "Je voudrais parler à un ami demain.",
  },
  "ht-HT": {
    form: "pale",
    text: "Mwen vle pale ak machann nan.",
    prompt: "At a market in Haiti, say in Kreyòl that you want to speak with the vendor.",
    answer: "Mwen vle pale ak machann nan.",
    reusePrompt: "Later, say you want to speak with a friend tomorrow.",
    reuseAnswer: "Mwen vle pale ak yon zanmi demen.",
  },
  "ca-ES": {
    form: "parlar",
    text: "Vull parlar amb la venedora.",
    prompt: "At a market, say in Catalan that you want to speak with the vendor.",
    answer: "Vull parlar amb la venedora.",
    reusePrompt: "Later, say you want to speak with a friend tomorrow.",
    reuseAnswer: "Vull parlar amb una amiga demà.",
  },
  "sw-TZ": {
    form: "kuzungumza",
    text: "Nataka kuzungumza na mwalimu.",
    prompt: "At a school in Tanzania, say in Kiswahili that you want to speak with the teacher.",
    answer: "Nataka kuzungumza na mwalimu.",
    reusePrompt: "Later, say you want to speak with a friend tomorrow.",
    reuseAnswer: "Nataka kuzungumza na rafiki kesho.",
  },
};

function speakVocabulary(code) {
  const example = SPEAK_EXAMPLES[code];
  return {
    id: `${code}-speak-vocabulary`,
    conceptId: "speak",
    kind: "vocabulary",
    label: `Use ${example.form} (to speak)`,
    target: `Retrieve and use ${example.form} to describe speaking with someone.`,
    input: {
      text: example.text,
      question: `What does “${example.form}” mean in this sentence?`,
      options: ["To speak with someone", "To buy food", "To write a letter"],
      correctIndex: 0,
      explanation: `${example.form} expresses speaking or talking in this context.`,
    },
    production: {
      prompt: example.prompt,
      modelAnswer: example.answer,
      rubric: `Credit natural use of ${example.form} to communicate speaking with someone; accept appropriate variations.`,
    },
    reuse: {
      prompt: example.reusePrompt,
      modelAnswer: example.reuseAnswer,
    },
  };
}

const CONCEPT_TAGS = {
  speak: ["conversation", "communication", "work", "friends"],
  "future-plan": ["plans", "daily life", "travel"],
  "weekend-invitation": ["friends", "social", "plans"],
  "past-narrative": ["stories", "daily life"],
  "ask-directions": ["travel", "directions"],
  "article-preposition": ["grammar", "daily life"],
  "completed-event": ["stories", "daily life"],
  "polite-request": ["travel", "food", "social"],
  "daily-routine": ["daily life", "habits"],
  "market-purchase": ["food", "shopping", "travel"],
  "noun-agreement": ["grammar", "daily life"],
  "greeting-exchange": ["social", "conversation", "travel"],
};

const definePack = (code, details) => ({
  code,
  ...details,
  skills: [...details.skills, speakVocabulary(code)].map((skill) => ({
    language: code, ...skill, tags: skill.tags ?? CONCEPT_TAGS[skill.conceptId] ?? [],
  })),
});

export const LANGUAGE_ALIASES = Object.freeze({
  pt: "pt-BR",
  es: "es-419",
  it: "it-IT",
  fr: "fr-FR",
  ht: "ht-HT",
  ca: "ca-ES",
  sw: "sw-TZ",
});

export const LANGUAGE_PACKS = Object.freeze({
  "pt-BR": definePack("pt-BR", {
    name: "Brazilian Portuguese",
    region: "Brazil",
    targetLevel: "C1",
    phonology: "Listen for nasal vowels and the rhythm of connected Brazilian speech; pronunciation varies by region.",
    register: "Use você in the starter dialogues and show when an expression is informal or polite.",
    culture: "Practice daily interactions in Brazil without treating one city's usage as universal.",
    sttLocale: "pt-BR",
    ttsLocale: "pt-BR",
    grammarTopics: ["ir + infinitive for plans", "present-tense invitations", "polite requests"],
    commonErrors: ["Spanish words inserted into Portuguese", "English-style word order", "recognizing a form without producing it"],
    skills: [
      {
        id: "pt-BR-near-future",
        conceptId: "future-plan",
        kind: "grammar",
        label: "Near-future plans with ir + infinitive",
        target: "Use vou/vai/vamos + infinitive to describe a concrete plan.",
        input: {
          text: "Eu vou visitar minha amiga no sábado.",
          question: "What is the speaker planning?",
          options: ["To visit a friend on Saturday", "To visit a friend yesterday", "To invite a friend next month"],
          correctIndex: 0,
          explanation: "Vou + visitar expresses a planned future action; no sábado gives the day.",
        },
        production: {
          prompt: "Tell a friend in Portuguese what you are going to do tomorrow. Include a place or activity.",
          modelAnswer: "Amanhã eu vou visitar o mercado do bairro.",
          rubric: "Accept a natural first-person plan using vou + an infinitive and a concrete time or activity; do not require the model wording.",
        },
        reuse: {
          prompt: "A different friend asks about your weekend. Answer in Portuguese with a new plan using ir + infinitive.",
          modelAnswer: "No domingo, vou encontrar meus amigos no parque.",
        },
      },
      {
        id: "pt-BR-conversation-plans",
        conceptId: "weekend-invitation",
        kind: "speaking",
        label: "Making weekend plans",
        target: "Make and respond to an informal weekend invitation in Brazilian Portuguese.",
        input: {
          text: "Vamos à feira no domingo?",
          question: "What is the speaker doing?",
          options: ["Inviting someone to the market on Sunday", "Describing a past market visit", "Asking the market's price"],
          correctIndex: 0,
          explanation: "Vamos à feira? is a natural invitation; no domingo specifies Sunday.",
        },
        production: {
          prompt: "Invite a friend in Brazil to do something this weekend, then offer a time.",
          modelAnswer: "Quer ir à feira comigo no sábado? Podemos ir de manhã.",
          rubric: "Credit an understandable invitation and a proposed day or time; accept other natural Brazilian phrasing.",
        },
        reuse: {
          prompt: "Your friend cannot meet Saturday. Suggest a different day and activity in Portuguese.",
          modelAnswer: "Sem problema. Podemos tomar um café no domingo?",
        },
      },
    ],
  }),
  "es-419": definePack("es-419", {
    name: "Latin American Spanish",
    region: "Latin America",
    targetLevel: "B2",
    phonology: "Train clear vowels and locally appropriate rhythm; avoid assuming one Latin American accent.",
    register: "Teach tú/usted choices as context-dependent, with regional variation.",
    culture: "Use varied Latin American settings and avoid presenting one country's forms as universal.",
    sttLocale: "es-MX",
    ttsLocale: "es-MX",
    grammarTopics: ["preterite versus imperfect", "questions and directions", "ir a + infinitive"],
    commonErrors: ["Portuguese vocabulary inserted into Spanish", "mixing preterite and imperfect", "dropping written question marks"],
    skills: [
      {
        id: "es-preterite-imperfect",
        conceptId: "past-narrative",
        kind: "grammar",
        label: "Preterite vs. imperfect",
        target: "Use background context and a completed action in a short past-tense story.",
        input: {
          text: "Llovía cuando salí de casa.",
          question: "Which action is completed?",
          options: ["Leaving the house", "The rain continuing", "Both actions are future plans"],
          correctIndex: 0,
          explanation: "Llovía sets background; salí marks the completed event.",
        },
        production: {
          prompt: "Describe in Spanish what the weather was like when you arrived at a market yesterday.",
          modelAnswer: "Hacía calor cuando llegué al mercado ayer.",
          rubric: "Look for an imperfect background form plus a completed preterite event; accept other coherent weather and event details.",
        },
        reuse: {
          prompt: "Tell a new two-part story in Spanish: what you were doing when a friend called.",
          modelAnswer: "Estudiaba cuando me llamó una amiga.",
        },
      },
      {
        id: "es-conversation-directions",
        conceptId: "ask-directions",
        kind: "speaking",
        label: "Asking for directions",
        target: "Ask where a place is and respond to a simple direction.",
        input: {
          text: "La biblioteca está a dos cuadras, a la derecha.",
          question: "Where is the library?",
          options: ["Two blocks away on the right", "Two streets away on the left", "Inside the market"],
          correctIndex: 0,
          explanation: "A dos cuadras means two blocks away; a la derecha means on the right.",
        },
        production: {
          prompt: "You are in an unfamiliar Latin American city. Ask politely where the library is.",
          modelAnswer: "Disculpe, ¿dónde está la biblioteca?",
          rubric: "Credit a complete, polite location question in Spanish; accept regionally natural alternatives.",
        },
        reuse: {
          prompt: "Ask a passerby where the bus station is, then thank them for the directions.",
          modelAnswer: "Disculpe, ¿dónde está la terminal de autobuses? Muchas gracias.",
        },
      },
    ],
  }),
  "it-IT": definePack("it-IT", {
    name: "Italian",
    region: "Italy",
    targetLevel: "B1–B2",
    phonology: "Distinguish single from double consonants and listen for stress and vowel clarity.",
    register: "Use polite requests in service encounters; introduce Lei when formality matters.",
    culture: "Practice ordinary Italian social and food contexts with room for regional variation.",
    sttLocale: "it-IT",
    ttsLocale: "it-IT",
    grammarTopics: ["articulated prepositions", "polite requests", "articles and gender"],
    commonErrors: ["omitting an article-preposition contraction", "Spanish or French words in Italian", "missing double consonants"],
    skills: [
      {
        id: "it-articulated-prepositions",
        conceptId: "article-preposition",
        kind: "grammar",
        label: "Articulated prepositions",
        target: "Combine a preposition and article in an ordinary destination or location phrase.",
        input: {
          text: "Vado al mercato dopo il lavoro.",
          question: "What does al express here?",
          options: ["A + il, meaning to the", "Di + il, meaning of the", "A past-tense verb"],
          correctIndex: 0,
          explanation: "Al combines a + il before mercato.",
        },
        production: {
          prompt: "Say in Italian that you are going to the museum tomorrow.",
          modelAnswer: "Domani vado al museo.",
          rubric: "Credit a grammatical destination phrase with al museo; minor word-order variation is fine.",
        },
        reuse: {
          prompt: "Say in Italian that you are at the market now.",
          modelAnswer: "Adesso sono al mercato.",
        },
      },
      {
        id: "it-conversation-restaurant",
        conceptId: "polite-request",
        kind: "speaking",
        label: "Ordering at a restaurant",
        target: "Order food politely and ask a brief follow-up question.",
        input: {
          text: "Vorrei un piatto di pasta, per favore.",
          question: "What is the speaker doing?",
          options: ["Ordering a plate of pasta politely", "Complaining about the pasta", "Asking for the bill"],
          correctIndex: 0,
          explanation: "Vorrei is a polite way to say I would like.",
        },
        production: {
          prompt: "At a restaurant in Italy, order a meal and ask whether still water is available.",
          modelAnswer: "Vorrei un piatto di pasta, per favore. Avete acqua naturale?",
          rubric: "Credit a polite meal order and an understandable follow-up question; accept a different meal.",
        },
        reuse: {
          prompt: "Order a different dish in Italian and ask for the bill.",
          modelAnswer: "Vorrei una zuppa, per favore. Potrei avere il conto?",
        },
      },
    ],
  }),
  "fr-FR": definePack("fr-FR", {
    name: "French",
    region: "France; adaptable to other Francophone regions",
    targetLevel: "B1–B2",
    phonology: "Connect spelling to actual spoken forms and practice liaison when appropriate.",
    register: "Teach tu/vous choices and polite requests in context.",
    culture: "Use France as one starting context while acknowledging the wider Francophone world.",
    sttLocale: "fr-FR",
    ttsLocale: "fr-FR",
    grammarTopics: ["passé composé", "polite requests", "spoken versus written French"],
    commonErrors: ["reading French spelling as pronunciation", "mixing auxiliary and participle", "using tu in a vous setting"],
    skills: [
      {
        id: "fr-passe-compose",
        conceptId: "completed-event",
        kind: "grammar",
        label: "Passé composé for completed events",
        target: "Describe one completed event with the right auxiliary and past participle.",
        input: {
          text: "Hier, j'ai visité le musée.",
          question: "When did the museum visit happen?",
          options: ["Yesterday", "Tomorrow", "Every week"],
          correctIndex: 0,
          explanation: "Hier means yesterday; j'ai visité is a completed past action.",
        },
        production: {
          prompt: "Tell a French-speaking friend one thing you did yesterday.",
          modelAnswer: "Hier, j'ai visité un musée.",
          rubric: "Look for a coherent completed event with a suitable auxiliary and past participle; accept different activities.",
        },
        reuse: {
          prompt: "In a later conversation, say how you got to town this morning.",
          modelAnswer: "Ce matin, j'ai pris le train pour aller en ville.",
        },
      },
      {
        id: "fr-conversation-cafe",
        conceptId: "polite-request",
        kind: "speaking",
        label: "Ordering at a café",
        target: "Order a drink politely and respond to a follow-up question.",
        input: {
          text: "Je voudrais un café, s'il vous plaît.",
          question: "What does the speaker want?",
          options: ["A coffee", "A tea", "The bill"],
          correctIndex: 0,
          explanation: "Je voudrais is a polite request; un café is a coffee.",
        },
        production: {
          prompt: "At a café, politely order a tea and ask whether you can sit outside.",
          modelAnswer: "Je voudrais un thé, s'il vous plaît. Est-ce que je peux m'asseoir dehors ?",
          rubric: "Credit a polite order plus an understandable seating question; accept other natural polite forms.",
        },
        reuse: {
          prompt: "Order water politely in a new café and thank the server.",
          modelAnswer: "Je voudrais de l'eau, s'il vous plaît. Merci.",
        },
      },
    ],
  }),
  "ht-HT": definePack("ht-HT", {
    name: "Haitian Creole (Kreyòl ayisyen)",
    region: "Haiti",
    targetLevel: "B1–B2",
    phonology: "Use Haitian Creole spelling and speech patterns on their own terms, rather than French spelling rules.",
    register: "Practice respectful requests with tanpri and everyday conversational forms.",
    culture: "Treat Kreyòl as an independent language rooted in Haitian life, not as simplified French.",
    sttLocale: "ht-HT",
    ttsLocale: "ht-HT",
    grammarTopics: ["pral for a near-future plan", "polite requests with ta renmen", "independent Creole tense markers"],
    commonErrors: ["importing French grammar into Kreyòl", "writing words with French orthography", "confusing a related French word with the Kreyòl form"],
    skills: [
      {
        id: "ht-near-future",
        conceptId: "future-plan",
        kind: "grammar",
        label: "Plans with pral",
        target: "State a near-future plan with pral in Haitian Creole.",
        input: {
          text: "Mwen pral ale nan mache a demen.",
          question: "When is the speaker going to the market?",
          options: ["Tomorrow", "Yesterday", "Every morning"],
          correctIndex: 0,
          explanation: "Demen means tomorrow; pral marks a forthcoming action.",
        },
        production: {
          prompt: "Tell a friend in Kreyòl that you are going to read tomorrow.",
          modelAnswer: "Mwen pral li demen.",
          rubric: "Credit a clear future plan with mwen + pral + an appropriate verb; do not demand French conjugation.",
        },
        reuse: {
          prompt: "In a later conversation, tell a friend you are going to speak with them tomorrow.",
          modelAnswer: "Mwen pral pale avè w demen.",
        },
      },
      {
        id: "ht-polite-request",
        conceptId: "polite-request",
        kind: "speaking",
        label: "A polite request for water",
        target: "Ask for a drink politely in Haitian Creole.",
        input: {
          text: "Mwen ta renmen yon vè dlo, tanpri.",
          question: "What is being requested?",
          options: ["A glass of water", "A cup of coffee", "A ride to the market"],
          correctIndex: 0,
          explanation: "Mwen ta renmen expresses I would like; yon vè dlo is a glass of water.",
        },
        production: {
          prompt: "At a small café in Haiti, politely ask for water in Kreyòl.",
          modelAnswer: "Mwen ta renmen yon vè dlo, tanpri.",
          rubric: "Credit an understandable, polite water request in Kreyòl; accept other natural phrasing.",
        },
        reuse: {
          prompt: "At another café, politely ask for a coffee in Kreyòl.",
          modelAnswer: "Mwen ta renmen yon kafe, tanpri.",
        },
      },
    ],
  }),
  "ca-ES": definePack("ca-ES", {
    name: "Catalan",
    region: "Catalonia; regional varieties configurable",
    targetLevel: "B1",
    phonology: "Connect written forms to Catalan vowel sounds; regional pronunciation varies.",
    register: "Use polite requests with si us plau and adjust address to the situation.",
    culture: "Teach Catalan in its own cultural context, not as a variant of Spanish.",
    sttLocale: "ca-ES",
    ttsLocale: "ca-ES",
    grammarTopics: ["present-tense routines", "polite market requests", "Catalan versus Spanish forms"],
    commonErrors: ["substituting Spanish words", "assuming identical Spanish pronunciation", "missing Catalan weak pronouns"],
    skills: [
      {
        id: "ca-present-routine",
        conceptId: "daily-routine",
        kind: "grammar",
        label: "Talking about a daily routine",
        target: "Describe two regular actions using Catalan present-tense forms.",
        input: {
          text: "Cada matí em llevo a les set i esmorzo a casa.",
          question: "What does the speaker do at home?",
          options: ["Has breakfast", "Has dinner", "Goes to bed"],
          correctIndex: 0,
          explanation: "Esmorzo means I have breakfast; cada matí means every morning.",
        },
        production: {
          prompt: "Describe in Catalan when you get up and one thing you do every morning.",
          modelAnswer: "Cada matí em llevo a les set i esmorzo a casa.",
          rubric: "Credit two understandable present-tense routine actions; allow different times and activities.",
        },
        reuse: {
          prompt: "Describe two things you usually do after work in Catalan.",
          modelAnswer: "Després de treballar, torno a casa i llegeixo una estona.",
        },
      },
      {
        id: "ca-conversation-market",
        conceptId: "market-purchase",
        kind: "speaking",
        label: "Buying food at a market",
        target: "Ask for an item and quantity politely in Catalan.",
        input: {
          text: "Voldria un quilo de pomes, si us plau.",
          question: "What does the customer ask for?",
          options: ["One kilo of apples", "One apple", "A kilo of pears"],
          correctIndex: 0,
          explanation: "Voldria is a polite request; un quilo de pomes means one kilo of apples.",
        },
        production: {
          prompt: "At a market, politely ask for a kilo of tomatoes in Catalan.",
          modelAnswer: "Voldria un quilo de tomàquets, si us plau.",
          rubric: "Credit a polite request with a quantity and item; accept other natural Catalan wordings.",
        },
        reuse: {
          prompt: "Ask for two kilos of oranges at another market stall in Catalan.",
          modelAnswer: "Voldria dos quilos de taronges, si us plau.",
        },
      },
    ],
  }),
  "sw-TZ": definePack("sw-TZ", {
    name: "Standard Kiswahili",
    region: "Tanzania; East African contexts",
    targetLevel: "B1–B2",
    phonology: "Practice clear syllables and listen to connected speech; avoid forcing Romance-language sound patterns.",
    register: "Give greetings the time and attention they receive in many East African interactions.",
    culture: "Use Tanzanian and wider East African contexts, with local variation presented honestly.",
    sttLocale: "sw-TZ",
    ttsLocale: "sw-TZ",
    grammarTopics: ["noun-class agreement", "greeting exchanges", "subject and tense prefixes"],
    commonErrors: ["using an adjective without class agreement", "translating English word-for-word", "skipping a greeting exchange"],
    skills: [
      {
        id: "sw-noun-class-agreement",
        conceptId: "noun-agreement",
        kind: "grammar",
        label: "Basic noun-class agreement",
        target: "Match a noun and adjective in Standard Kiswahili.",
        input: {
          text: "Hiki ni kitabu kizuri.",
          question: "Which adjective agrees with kitabu?",
          options: ["kizuri", "mzuri", "wazuri"],
          correctIndex: 0,
          explanation: "Kitabu is in the ki-/vi- class; the adjective takes ki- in the singular.",
        },
        production: {
          prompt: "Say in Kiswahili: These are good books.",
          modelAnswer: "Hivi ni vitabu vizuri.",
          rubric: "Look for the plural vi- agreement on vitabu and vizuri; accept a complete natural equivalent.",
        },
        reuse: {
          prompt: "Later, describe one good book in Kiswahili.",
          modelAnswer: "Hiki ni kitabu kizuri.",
        },
      },
      {
        id: "sw-conversation-greetings",
        conceptId: "greeting-exchange",
        kind: "speaking",
        label: "Greetings and wellbeing",
        target: "Greet someone and respond to a basic wellbeing question in Standard Kiswahili.",
        input: {
          text: "Hujambo? Sijambo, asante.",
          question: "How does the second speaker say they are well?",
          options: ["Sijambo", "Hujambo", "Kwaheri"],
          correctIndex: 0,
          explanation: "Sijambo is a conventional response to Hujambo; asante means thank you.",
        },
        production: {
          prompt: "You meet someone in Tanzania. Greet them and respond when they ask Hujambo?",
          modelAnswer: "Hujambo? Sijambo, asante.",
          rubric: "Credit a coherent greeting exchange; accept another appropriate Standard Kiswahili greeting and response.",
        },
        reuse: {
          prompt: "At a later meeting, ask how someone is and answer a similar question in Kiswahili.",
          modelAnswer: "Habari gani? Nzuri, asante.",
        },
      },
    ],
  }),
});

const SKILL_INDEX = new Map(
  Object.values(LANGUAGE_PACKS).flatMap((pack) => pack.skills.map((skill) => [skill.id, skill])),
);

export function getLanguagePack(code) {
  if (typeof code !== "string") return undefined;
  return LANGUAGE_PACKS[LANGUAGE_ALIASES[code] ?? code];
}

export function listLanguages() {
  return Object.values(LANGUAGE_PACKS).map(({ skills, ...metadata }) => ({
    ...metadata,
    skillCount: skills.length,
  }));
}

export function getSkill(skillId) {
  return SKILL_INDEX.get(skillId);
}

export function skillsForLanguage(code) {
  return getLanguagePack(code)?.skills ?? [];
}

export { CONCEPTS, RELATIONSHIPS } from "./concept-graph.js";
