import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountProfile } from './components/AccountProfile';
import { ProfileAvatar } from './components/ProfileAvatar';
import { prepareProfilePhoto } from './lib/profilePhoto';
const updateProfile = vi.hoisted(() => vi.fn());
vi.mock('./context/AuthContext', () => ({ useAuth: () => ({ updateProfile }) }));
vi.mock('./lib/profilePhoto', () => ({ prepareProfilePhoto: vi.fn() }));
const user = { first_name: 'Ana', last_name: 'Brooks', email: 'ana@example.test' };
const photo = 'data:image/jpeg;base64,fixture';
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('uses initials without a photo and falls back if an image fails to load', () => {
  const view = render(<ProfileAvatar user={user} />);
  expect(screen.getByText('AB')).toBeTruthy();
  view.rerender(<ProfileAvatar user={{ ...user, profile_photo: photo }} />);
  const image = view.container.querySelector('img');
  expect(image.getAttribute('src')).toBe(photo);
  fireEvent.error(image);
  expect(screen.getByText('AB')).toBeTruthy();
  expect(view.container.querySelector('img')).toBeNull();
});

it('saves an edited name and resized photo together only after Save changes', async () => {
  const events = userEvent.setup();
  prepareProfilePhoto.mockResolvedValue(photo);
  updateProfile.mockResolvedValue({ ...user, profile_photo: photo });
  render(<AccountProfile user={user} />);
  await events.click(screen.getByRole('button', { name: 'Edit profile' }));
  await events.clear(screen.getByLabelText('First name'));
  await events.type(screen.getByLabelText('First name'), 'Ann');
  await events.upload(
    screen.getByLabelText('Profile photo'),
    new File(['photo'], 'photo.png', { type: 'image/png' }),
  );
  await screen.findByRole('button', { name: 'Remove photo' });
  expect(updateProfile).not.toHaveBeenCalled();
  await events.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(updateProfile).toHaveBeenCalledWith({
    first_name: 'Ann',
    last_name: 'Brooks',
    profile_photo: photo,
  });
  expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Profile updated.');
  expect(screen.queryByRole('form', { name: 'Edit profile' })).toBeNull();
});

it('can discard a photo removal or explicitly save it and return to initials', async () => {
  const events = userEvent.setup();
  updateProfile.mockResolvedValue(user);
  const view = render(<AccountProfile user={{ ...user, profile_photo: photo }} />);
  await events.click(screen.getByRole('button', { name: 'Edit profile' }));
  await events.click(screen.getByRole('button', { name: 'Remove photo' }));
  expect(screen.getByText('AB')).toBeTruthy();
  await events.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(view.container.querySelector('img').getAttribute('src')).toBe(photo);
  expect(updateProfile).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit profile' }));
  await events.click(screen.getByRole('button', { name: 'Edit profile' }));
  await events.click(screen.getByRole('button', { name: 'Remove photo' }));
  await events.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByRole('status');
  expect(updateProfile).toHaveBeenCalledWith({
    first_name: 'Ana',
    last_name: 'Brooks',
    profile_photo: null,
  });
});

it('keeps the draft on an upload or save failure so the user can correct it', async () => {
  const events = userEvent.setup();
  prepareProfilePhoto.mockRejectedValue(new Error('Choose a photo under 5 MB.'));
  updateProfile.mockRejectedValue(new Error('Could not save. Try again.'));
  render(<AccountProfile user={user} />);
  await events.click(screen.getByRole('button', { name: 'Edit profile' }));
  await events.upload(
    screen.getByLabelText('Profile photo'),
    new File(['photo'], 'photo.png', { type: 'image/png' }),
  );
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Choose a photo under 5 MB.',
  );
  await events.type(screen.getByLabelText('First name'), ' Marie');
  await events.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Could not save. Try again.',
  );
  expect(screen.getByLabelText('First name').value).toBe('Ana Marie');
});
