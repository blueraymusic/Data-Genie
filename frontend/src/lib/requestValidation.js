export const incompleteRequest =
  'Describe what you want to see or change, for example "show all customers".';

export function requestProblem(text, hasContext = false) {
  if (['schema', 'tables'].includes(text.toLowerCase().trim().replace(/\?$/u, ''))) return '';
  const words = text.match(/[\p{L}\p{N}_]+/gu) || [];
  if (hasContext && words.length === 1 && words[0].length >= 3 && /^\p{L}+$/u.test(words[0]))
    return '';
  return words.length < 2 || !/\p{L}/u.test(text) ? incompleteRequest : '';
}
