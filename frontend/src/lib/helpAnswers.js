import { faqAnswerAnchor, faqGroups } from '../data/faq';

const filler = new Set(
  'a an about are be can could did do does for from give has help how i in is it know like me my need of on please should tell than the there these this to use want was what when where which who will with would you your data genie'.split(
    ' ',
  ),
);
const variants = {
  files: 'file',
  uploads: 'upload',
  uploading: 'upload',
  uploaded: 'upload',
  databases: 'database',
  postgres: 'postgresql',
  connecting: 'connect',
  connections: 'connection',
  resets: 'reset',
  resetting: 'reset',
  reports: 'report',
  results: 'result',
  changes: 'change',
  requests: 'request',
  spreadsheets: 'spreadsheet',
  works: 'work',
};

function normalize(text) {
  return (
    text
      .toLowerCase()
      .replace(/[’']/g, '')
      .match(/[a-z0-9]+/g) || []
  ).join(' ');
}

function keywords(text) {
  return normalize(text)
    .split(' ')
    .filter((word) => word && !filler.has(word))
    .map((word) => (Object.hasOwn(variants, word) ? variants[word] : word));
}

const index = faqGroups.flatMap((group) =>
  group.items.map((item) => {
    const questions = [item.question, ...(item.help || [])];
    const phrases = questions.map(keywords);
    return {
      question: item.question,
      answer: item.answer,
      href: '/faq#' + faqAnswerAnchor(item.question),
      exact: questions.map(normalize),
      phrases,
      search: new Set([...phrases.flat(), ...keywords(item.search)]),
    };
  }),
);

export function findHelpAnswers(question) {
  const original = normalize(question);
  if (!original) return [];
  const direct = index.find((item) => item.exact.includes(original));
  if (direct) return [direct];
  const words = keywords(question);
  if (words.length < 2) return [];

  const phrase = words.join(' ');
  const exact = index.find(({ phrases }) =>
    phrases.some((candidate) => candidate.join(' ') === phrase),
  );
  if (exact) return [exact];

  const terms = [...new Set(words)];
  if (terms.length < 2) return [];

  // Require both a recognizable FAQ question and coverage of the visitor's wording.
  const ranked = index
    .flatMap((item) => {
      const covered = terms.filter((word) => item.search.has(word)).length;
      const intent = Math.max(
        ...item.phrases.map((part) => terms.filter((word) => part.includes(word)).length),
      );
      if (intent < 2 || covered / terms.length < 0.8) return [];
      return [{ item, score: 3 * intent + covered }];
    })
    .sort((first, second) => second.score - first.score);
  const [best, runnerUp] = ranked;
  if (!best) return [];
  if (!runnerUp || best.score > runnerUp.score + 1) return [best.item];
  return ranked.slice(0, 3).map(({ item }) => item);
}
