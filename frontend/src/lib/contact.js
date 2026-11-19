export const contactEmail = 'sissokoadel057@gmail.com';
export const contactReasons = [
  'Getting started',
  'Database connection',
  'Report a problem',
  'Feedback or a feature idea',
  'Something else',
];

export function contactDraft(values) {
  const read = (key) => String(values.get(key) || '').trim();
  const name = [read('first_name'), read('last_name')].filter(Boolean).join(' ');
  const reason = contactReasons.includes(read('reason')) ? read('reason') : 'General question';
  const subject = 'Data Genie — ' + reason;
  const body = [
    read('message'),
    '',
    '—',
    'Name: ' + name,
    'Email: ' + read('email'),
    ...(read('company') ? ['Organization: ' + read('company')] : []),
    'Reason: ' + reason,
  ].join('\n');
  return {
    subject,
    body,
    url: `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  };
}
