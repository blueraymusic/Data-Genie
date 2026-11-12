import { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDismissMotion,
  useEnterMotion,
  useReducedMotion,
  useScrollReveal,
} from './hooks/useMotion';
import { HeroDemo } from './components/HeroDemo';
import { demos } from './data/home';
import { Router } from './lib/router';

let media, listeners, records, observers;
const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');

function changePreference(reduced) {
  act(() => {
    media.matches = reduced;
    [...listeners].forEach((changed) => changed({ matches: reduced }));
  });
}
function Entry({ motionKey = 'first', ready = true }) {
  const ref = useRef(null);
  useEnterMotion(ref, motionKey, ready);
  return (
    <main ref={ref}>
      <label>
        Draft
        <input defaultValue="Original draft" />
      </label>
    </main>
  );
}
function Dismiss({ onClose }) {
  const ref = useRef(null);
  const { dismiss, closing } = useDismissMotion(ref, onClose);
  return (
    <section
      ref={ref}
      data-closing={closing}
      onKeyDown={(event) => {
        if (event.key === 'Escape') dismiss();
      }}
    >
      <button onClick={dismiss}>Close panel</button>
    </section>
  );
}
function Reveal() {
  const ref = useRef(null);
  useScrollReveal(ref, '.reveal');
  return (
    <main ref={ref}>
      <article className="reveal" data-motion-delay="500">
        <label>
          Revealed input
          <input />
        </label>
      </article>
      <h2 className="reveal">Always available content</h2>
    </main>
  );
}

beforeEach(() => {
  listeners = new Set();
  records = [];
  observers = [];
  media = {
    matches: false,
    addEventListener: vi.fn((event, changed) => listeners.add(changed)),
    removeEventListener: vi.fn((event, changed) => listeners.delete(changed)),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback) {
        this.callback = callback;
        this.observe = vi.fn();
        this.unobserve = vi.fn();
        this.disconnect = vi.fn();
        observers.push(this);
      }
      enter(node) {
        this.callback([{ target: node, isIntersecting: true }]);
      }
    },
  );
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(function (frames, options) {
      const animation = { cancel: vi.fn(), onfinish: null };
      records.push({ node: this, frames, options, animation });
      return animation;
    }),
  });
  window.scrollTo = vi.fn();
  history.replaceState({}, '', '/');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
  else delete Element.prototype.animate;
});

describe('motion preferences', () => {
  it('updates immediately and removes its media listener on unmount', () => {
    function Preference() {
      return <p>{useReducedMotion() ? 'Still' : 'Animated'}</p>;
    }
    const view = render(<Preference />);
    expect(screen.getByText('Animated')).toBeTruthy();
    changePreference(true);
    expect(screen.getByText('Still')).toBeTruthy();
    view.unmount();
    expect(listeners.size).toBe(0);
    expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('supports older media listeners and chooses still content when matchMedia is absent', () => {
    media.addEventListener = undefined;
    media.removeEventListener = undefined;
    media.addListener = vi.fn((changed) => listeners.add(changed));
    media.removeListener = vi.fn((changed) => listeners.delete(changed));
    const first = render(<Entry />);
    changePreference(true);
    expect(records[0].animation.cancel).toHaveBeenCalled();
    first.unmount();
    expect(listeners.size).toBe(0);
    vi.stubGlobal('matchMedia', undefined);
    render(<Entry />);
    expect(records).toHaveLength(1);
    expect(screen.getByLabelText('Draft').value).toBe('Original draft');
  });

  it('finishes hero typing immediately when reduced motion turns on and cancels its timers', () => {
    vi.useFakeTimers();
    render(
      <Router>
        <HeroDemo />
      </Router>,
    );
    act(() => vi.advanceTimersByTime(48));
    expect(document.querySelector('.demo-request').textContent).not.toBe(demos[0].request);
    changePreference(true);
    expect(document.querySelector('.demo-request').textContent).toBe(demos[0].request);
    expect(document.querySelector('.demo-sql-loading')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(2000));
    expect(document.querySelector('.demo-request').textContent).toBe(demos[0].request);
  });

  it('preserves a sample approval when the operating-system motion preference changes', () => {
    vi.useFakeTimers();
    media.matches = true;
    render(
      <Router>
        <HeroDemo />
      </Router>,
    );
    fireEvent.click(screen.getByRole('button', { name: demos[2].request }));
    fireEvent.click(screen.getByRole('button', { name: 'Add customer' }));
    expect(screen.getByText('1 row added to customers. Sample only.')).toBeTruthy();
    changePreference(false);
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText('1 row added to customers. Sample only.')).toBeTruthy();
    changePreference(true);
    expect(screen.getByText('1 row added to customers. Sample only.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add customer' })).toBeNull();
  });
});

describe('entry motion', () => {
  it('waits for ready content without replacing inputs or replaying on unrelated renders', () => {
    const view = render(<Entry ready={false} />);
    const input = screen.getByLabelText('Draft');
    fireEvent.change(input, { target: { value: 'Keep this draft' } });
    expect(records).toHaveLength(0);
    view.rerender(<Entry ready />);
    expect(records).toHaveLength(1);
    view.rerender(<Entry ready />);
    expect(records).toHaveLength(1);
    expect(screen.getByLabelText('Draft')).toBe(input);
    expect(input.value).toBe('Keep this draft');
  });
  it('keeps existing input DOM and draft state when a view key changes, then cancels for focus', () => {
    const view = render(<Entry />);
    const input = screen.getByLabelText('Draft');
    fireEvent.change(input, { target: { value: 'An unfinished query' } });
    view.rerender(<Entry motionKey="second" />);
    expect(screen.getByLabelText('Draft')).toBe(input);
    expect(input.value).toBe('An unfinished query');
    expect(records).toHaveLength(2);
    expect(records[0].animation.cancel).toHaveBeenCalledOnce();
    expect(records[1].frames.every((frame) => !('transform' in frame))).toBe(true);
    act(() => input.focus());
    expect(document.activeElement).toBe(input);
    expect(records[1].animation.cancel).toHaveBeenCalledOnce();
    view.rerender(<Entry motionKey="third" />);
    expect(records).toHaveLength(2);
  });

  it('cancels an active entry when motion is reduced and leaves unsupported browsers usable', () => {
    const first = render(<Entry />);
    changePreference(true);
    expect(records[0].animation.cancel).toHaveBeenCalledOnce();
    first.unmount();
    changePreference(false);
    delete Element.prototype.animate;
    render(<Entry />);
    expect(records).toHaveLength(1);
    expect(screen.getByLabelText('Draft').value).toBe('Original draft');
  });
});

describe('dialog dismissal', () => {
  it('keeps the panel mounted during exit and calls its close action exactly once', () => {
    const close = vi.fn();
    render(<Dismiss onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    const panel = screen.getByRole('button').closest('section');
    expect(panel.dataset.closing).toBe('true');
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(records).toHaveLength(1);
    const finish = records[0].animation.onfinish;
    act(() => finish());
    expect(close).toHaveBeenCalledOnce();
    act(() => finish());
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes immediately if reduced motion is enabled during exit', () => {
    const close = vi.fn();
    render(<Dismiss onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    changePreference(true);
    expect(close).toHaveBeenCalledOnce();
    expect(records[0].animation.cancel).toHaveBeenCalledOnce();
  });

  it('cancels an abandoned exit without a late close callback and has a no-animation fallback', () => {
    const close = vi.fn();
    const view = render(<Dismiss onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    const finish = records[0].animation.onfinish;
    view.unmount();
    act(() => finish());
    expect(close).not.toHaveBeenCalled();
    expect(records[0].animation.cancel).toHaveBeenCalledOnce();
    delete Element.prototype.animate;
    render(<Dismiss onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('one-time scroll reveals', () => {
  it('reveals intersecting content once, clamps delays, and stops a reveal containing keyboard focus', () => {
    const view = render(<Reveal />);
    const input = screen.getByLabelText('Revealed input');
    const target = input.closest('article');
    expect(target.style.opacity).toBe('');
    expect(observers[0].observe).toHaveBeenCalledTimes(2);
    act(() => observers[0].enter(target));
    act(() => observers[0].enter(target));
    expect(records).toHaveLength(1);
    expect(records[0].options.delay).toBe(140);
    expect(records[0].options.duration).toBe(440);
    act(() => input.focus());
    expect(records[0].animation.cancel).toHaveBeenCalledOnce();
    view.unmount();
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
  });

  it('cancels active reveals on reduced motion and ignores late observer callbacks after cleanup', () => {
    const view = render(<Reveal />);
    const heading = screen.getByRole('heading');
    const first = observers[0];
    act(() => first.enter(heading));
    changePreference(true);
    expect(records[0].animation.cancel).toHaveBeenCalledOnce();
    expect(first.disconnect).toHaveBeenCalledOnce();
    expect(heading.style.opacity).toBe('');
    act(() => first.enter(screen.getByLabelText('Revealed input').closest('article')));
    expect(records).toHaveLength(1);
    changePreference(false);
    expect(observers).toHaveLength(2);
    expect(observers[1].observe).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(observers[1].disconnect).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it('leaves all content visible without IntersectionObserver or element animation support', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const first = render(<Reveal />);
    expect(screen.getByRole('heading').style.opacity).toBe('');
    expect(screen.getByLabelText('Revealed input').closest('article').hidden).toBe(false);
    expect(records).toHaveLength(0);
    first.unmount();
    vi.stubGlobal('IntersectionObserver', vi.fn());
    delete Element.prototype.animate;
    render(<Reveal />);
    expect(IntersectionObserver).not.toHaveBeenCalled();
    expect(screen.getByRole('heading').textContent).toBe('Always available content');
  });
});
