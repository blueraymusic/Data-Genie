export const contactEmail = 'sissokoadel057@gmail.com';
export const contactTopics = [
  {
    id: 'demo',
    label: 'Request a Demo',
    hint: 'Tell us what you’d like to see and your time zone.',
  },
  {
    id: 'support',
    label: 'Technical Support',
    hint: 'Tell us what happened and what you expected.',
  },
  {
    id: 'enterprise',
    label: 'Enterprise & Pricing',
    hint: 'Tell us about your team size and what you need.',
  },
  { id: 'partners', label: 'Partnerships', hint: 'Tell us what you’d like to do together.' },
];

export function contactDraft(values) {
  const read = (key) => String(values.get(key) || '').trim();
  const topic = contactTopics.find(({ id }) => id === read('topic'));
  const subject = 'Data Genie — ' + (topic?.label || 'General question');
  const body = [
    read('message'),
    '',
    '—',
    'Name: ' + read('full_name'),
    'Email: ' + read('email'),
    ...(read('company') ? ['Organization: ' + read('company')] : []),
  ].join('\n');
  return {
    subject,
    body,
    url: `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  };
}
