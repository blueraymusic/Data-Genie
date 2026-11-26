import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { useAutosizeTextarea } from './hooks/useAutosizeTextarea';
import { useFileDrop } from './hooks/useFileDrop';
import { DatabaseForm } from './components/DatabaseForm';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function Editor({ value }) {
  const ref = useRef(null);
  useAutosizeTextarea(ref, value);
  return (
    <textarea
      aria-label="Writing"
      ref={ref}
      value={value}
      readOnly
      style={{ minHeight: 80, border: '1px solid' }}
    />
  );
}
it('grows for incoming text and width changes, then shrinks when text is removed', () => {
  let height = 320;
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}]);
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(() => height);
  const view = render(<Editor value="Partner text" />);
  const input = screen.getByRole('textbox');
  expect(input.style.height).toBe('322px');
  height = 540;
  fireEvent(window, new Event('resize'));
  expect(input.style.height).toBe('542px');
  height = 20;
  view.rerender(<Editor value="Short" />);
  expect(input.style.height).toBe('80px');
});
function Drop({ disabled, onFiles }) {
  const drop = useFileDrop({ disabled, onFiles });
  return (
    <div aria-label="Drop files" data-active={drop.active} {...drop.handlers}>
      <span>Inner content</span>
    </div>
  );
}
it('keeps file feedback over child content, ignores text drags, and blocks disabled drops', () => {
  const onFiles = vi.fn(),
    view = render(<Drop onFiles={onFiles} />);
  const target = screen.getByLabelText('Drop files'),
    child = screen.getByText('Inner content');
  const file = new File(['data'], 'sample.pdf', { type: 'application/pdf' });
  fireEvent.dragOver(target, { dataTransfer: { types: ['text/plain'] } });
  expect(target.dataset.active).toBe('false');
  fireEvent.dragOver(target, { dataTransfer: { types: ['Files'] } });
  expect(target.dataset.active).toBe('true');
  const leave = new Event('dragleave', { bubbles: true });
  Object.defineProperty(leave, 'relatedTarget', { value: child });
  fireEvent(target, leave);
  expect(target.dataset.active).toBe('true');
  fireEvent.drop(target, { dataTransfer: { files: [file] } });
  expect(onFiles).toHaveBeenCalledWith([file]);
  expect(target.dataset.active).toBe('false');
  view.rerender(<Drop disabled onFiles={onFiles} />);
  fireEvent.drop(target, { dataTransfer: { files: [file] } });
  expect(onFiles).toHaveBeenCalledTimes(1);
});
it('rejects multiple, empty, and oversized database drops without creating or opening anything', () => {
  const onOpen = vi.fn(),
    { container } = render(<DatabaseForm onOpen={onOpen} />);
  const form = container.querySelector('form');
  const small = new File(['sqlite'], 'one.sqlite3');
  fireEvent.drop(form, { dataTransfer: { files: [small, small] } });
  expect(screen.getByRole('status').textContent).toContain('one SQLite database');
  fireEvent.drop(form, { dataTransfer: { files: [new File([], 'empty.sqlite3')] } });
  expect(screen.getByRole('status').textContent).toContain('1 byte and 25 MB');
  const large = new File(['data'], 'large.sqlite3');
  Object.defineProperty(large, 'size', { value: 26 * 1024 * 1024 });
  fireEvent.drop(form, { dataTransfer: { files: [large] } });
  expect(onOpen).not.toHaveBeenCalled();
});

it('opens the SQLite picker, shows the selected file, and uploads it under the chosen name', async () => {
  const onOpen = vi.fn();
  render(<DatabaseForm initialMode="upload" onOpen={onOpen} />);
  const input = screen.getByLabelText('SQLite file');
  const open = screen.getByRole('button', { name: 'Open SQLite file' });
  const pick = vi.spyOn(input, 'click');
  expect(open.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
  expect(pick).toHaveBeenCalledOnce();
  const file = Object.assign(new File(['sqlite'], 'inventory.sqlite3'), {
    arrayBuffer: async () => new TextEncoder().encode('sqlite').buffer,
  });
  fireEvent.change(input, { target: { files: [file] } });
  expect(screen.getByText('inventory.sqlite3', { exact: true })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Replace file' })).toBeTruthy();
  fireEvent.change(input, { target: { files: [new File([], 'empty.sqlite3')] } });
  expect(screen.getByRole('status').textContent).toContain('1 byte and 25 MB');
  expect(screen.getByLabelText('Save database as').value).toBe('inventory.sqlite3');
  fireEvent.change(screen.getByLabelText('Save database as'), {
    target: { value: 'Stock.sqlite3' },
  });
  fireEvent.click(open);
  await waitFor(() =>
    expect(onOpen).toHaveBeenCalledWith({
      database_mode: 'upload',
      name: 'Stock.sqlite3',
      contents: btoa('sqlite'),
    }),
  );
});
