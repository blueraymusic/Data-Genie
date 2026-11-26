import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { walkthroughSteps } from '../data/workspaceWalkthrough';
import { useDismissMotion } from '../hooks/useMotion';
import { useRouter } from '../lib/router';
import { Icon } from './Icon';
import { Modal } from './Modal';

const margin = 12;
const gap = 14;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(value, maximum));

function spotlightGeometry(target, dialog, card) {
  const { width, height } = dialog.getBoundingClientRect();
  const cardWidth = card.offsetWidth;
  const cardHeight = card.offsetHeight;
  const rect = target?.getBoundingClientRect();
  const center = { x: (width - cardWidth) / 2, y: (height - cardHeight) / 2 };
  if (!rect || rect.bottom <= 0 || rect.top >= height) return { ...center, frame: null };

  const left = clamp(Math.floor(rect.left - 6), 4, width - 4);
  const top = clamp(Math.floor(rect.top - 6), 4, height - 4);
  const right = clamp(Math.ceil(rect.right + 6), left, width - 4);
  const bottom = clamp(Math.ceil(rect.bottom + 6), top, height - 4);
  const centeredX = clamp((left + right - cardWidth) / 2, margin, width - cardWidth - margin);
  const centeredY = clamp((top + bottom - cardHeight) / 2, margin, height - cardHeight - margin);
  const spaces = [
    { room: height - bottom - cardHeight, x: centeredX, y: bottom + gap },
    { room: top - cardHeight, x: centeredX, y: top - gap - cardHeight },
    { room: width - right - cardWidth, x: right + gap, y: centeredY },
    { room: left - cardWidth, x: left - gap - cardWidth, y: centeredY },
  ];
  const spot =
    spaces.find(({ room }) => room >= margin + gap) ||
    spaces.reduce((best, option) => (option.room > best.room ? option : best));
  return {
    x: clamp(Math.round(spot.x), margin, width - cardWidth - margin),
    y: clamp(Math.round(spot.y), margin, height - cardHeight - margin),
    frame: { left, top, right, bottom },
  };
}

function useSpotlight(surface, selector, dialog, card) {
  const [geometry, setGeometry] = useState(null);
  useLayoutEffect(() => {
    let target;
    let scheduled;
    const root = surface.current;
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(queue) : null;
    const changes = new MutationObserver(queue);

    function queue() {
      cancelAnimationFrame(scheduled);
      scheduled = requestAnimationFrame(measure);
    }
    function measure() {
      const next = [...root.querySelectorAll(selector)].find((element) => {
        const { width, height } = element.getBoundingClientRect();
        return width > 0 && height > 0 && getComputedStyle(element).visibility === 'visible';
      });
      if (next !== target) {
        if (target) resize?.unobserve(target);
        if (next) {
          resize?.observe(next);
          next.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        }
        target = next;
      }
      const position = spotlightGeometry(target, dialog.current, card.current);
      setGeometry((current) =>
        JSON.stringify(current) === JSON.stringify(position) ? current : position,
      );
    }
    changes.observe(root, { childList: true, subtree: true });
    resize?.observe(dialog.current);
    resize?.observe(card.current);
    window.addEventListener('resize', queue);
    window.addEventListener('scroll', queue, true);
    measure();
    queue();
    return () => {
      cancelAnimationFrame(scheduled);
      changes.disconnect();
      resize?.disconnect();
      window.removeEventListener('resize', queue);
      window.removeEventListener('scroll', queue, true);
    };
  }, [surface, selector, dialog, card]);
  return geometry;
}

export function WorkspaceWalkthrough({ surface, step, index, setIndex, replay, dismiss }) {
  const [, selector, title, description] = step;
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef(null);
  const card = useRef(null);
  const heading = useRef(null);
  const last = index === walkthroughSteps.length - 1;
  const { dismiss: close, closing } = useDismissMotion(card, dismiss);
  const geometry = useSpotlight(surface, selector, dialog, card);
  const frame = geometry?.frame;

  useLayoutEffect(() => {
    heading.current.focus({ preventScroll: true });
  }, [index]);

  return (
    <Modal
      className="walkthrough-dialog"
      titleId={titleId}
      descriptionId={descriptionId}
      onClose={close}
      panelRef={dialog}
      closing={closing}
    >
      <div
        className="walkthrough-scrim"
        aria-hidden="true"
        style={
          frame
            ? {
                '--spotlight-left': frame.left + 'px',
                '--spotlight-top': frame.top + 'px',
                '--spotlight-width': frame.right - frame.left + 'px',
                '--spotlight-height': frame.bottom - frame.top + 'px',
              }
            : undefined
        }
      >
        <span />
        <span />
        <span />
        <span />
      </div>
      {frame && (
        <div
          aria-hidden="true"
          className="walkthrough-focus"
          style={{
            left: frame.left,
            top: frame.top,
            width: frame.right - frame.left,
            height: frame.bottom - frame.top,
          }}
        />
      )}
      <section
        ref={card}
        className="walkthrough-callout"
        style={geometry ? { left: geometry.x, top: geometry.y } : undefined}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' && index > 0) setIndex(index - 1);
          if (event.key === 'ArrowRight' && !last) setIndex(index + 1);
        }}
      >
        <div className="walkthrough-copy" key={index}>
          <p className="walkthrough-progress">
            Step {index + 1} of {walkthroughSteps.length}
          </p>
          <h2 id={titleId} ref={heading} tabIndex={-1}>
            {title}
          </h2>
          <p id={descriptionId}>{description}</p>
        </div>
        <footer className="walkthrough-actions">
          <button type="button" className="walkthrough-skip" onClick={close}>
            Skip tour
          </button>
          <div>
            <button
              type="button"
              className="walkthrough-button"
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
            >
              Previous
            </button>
            <button
              type="button"
              className="walkthrough-button walkthrough-next"
              onClick={last ? close : () => setIndex(index + 1)}
            >
              {last ? (replay ? 'Done' : 'Finish') : 'Next'}{' '}
              <Icon name={last ? 'check' : 'arrow'} />
            </button>
          </div>
        </footer>
      </section>
    </Modal>
  );
}

export function useWorkspaceWalkthrough(surface, ready) {
  const { user, completeWalkthrough } = useAuth();
  const { route, pathname, navigate } = useRouter();
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const returnFocus = useRef(null);
  const url = new URL(route, window.location.origin);
  const replay = pathname === '/account' && url.searchParams.get('walkthrough') === '1';
  const firstVisit = pathname === '/databases' && user?.walkthrough_pending && !dismissed;
  const active = Boolean(ready && (replay || firstVisit));
  useLayoutEffect(() => {
    if (active || !returnFocus.current) return;
    surface.current.querySelector(returnFocus.current)?.focus();
    returnFocus.current = null;
  }, [active, surface]);
  useEffect(() => {
    if (!active) setIndex(0);
  }, [active]);

  function dismiss() {
    returnFocus.current = replay ? '[data-tour="replay"]' : '#gateTitle, #workspaceContent';
    setDismissed(true);
    setIndex(0);
    if (replay) {
      url.searchParams.delete('walkthrough');
      navigate(url.pathname + url.search + url.hash, true);
    }
    if (user?.walkthrough_pending) completeWalkthrough().catch(() => {});
  }

  return { step: active ? walkthroughSteps[index] : null, index, setIndex, replay, dismiss };
}
