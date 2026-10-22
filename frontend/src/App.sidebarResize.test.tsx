import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import App from './App';
import { createMockReviewApi } from './api/mock';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('innerWidth', 1400);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function open() {
  const view = render(<App api={createMockReviewApi(localStorage, 0)} />);
  await screen.findByRole('button', { name: 'Fetch a user by ID' });
  return view;
}

it('bounds and persists the width, restores it after collapse, and leaves room for the editor on smaller screens', async () => {
  const view = await open();
  const handle = screen.getByRole('separator', { name: 'Resize sidebar' });
  expect(handle.getAttribute('aria-valuenow')).toBe('360');
  fireEvent.keyDown(handle, { key: 'End' });
  expect(handle.getAttribute('aria-valuenow')).toBe('560');
  fireEvent.keyDown(handle, { key: 'ArrowRight' });
  expect(handle.getAttribute('aria-valuenow')).toBe('560');
  fireEvent.keyDown(handle, { key: 'ArrowLeft' });
  expect(handle.getAttribute('aria-valuenow')).toBe('550');
  await waitFor(() =>
    expect(localStorage.getItem('reviewlet.sidebar-width')).toBe('550'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
  expect(screen.getByRole('separator').getAttribute('aria-valuetext')).toBe(
    'Collapsed',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe(
    '550',
  );
  view.unmount();
  await open();
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe(
    '550',
  );
  vi.stubGlobal('innerWidth', 900);
  fireEvent(window, new Event('resize'));
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe(
    '450',
  );
  vi.stubGlobal('innerWidth', 1400);
  fireEvent(window, new Event('resize'));
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe(
    '550',
  );
});

function pointer(target: Element, type: string, x: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(target, event);
}

it('keeps one drag captured through collapse, reversal, and expansion', async () => {
  const { container } = await open();
  const handle = screen.getByRole('separator');
  const release = vi.fn();
  Object.assign(handle, {
    setPointerCapture: vi.fn(),
    releasePointerCapture: release,
  });
  pointer(handle, 'pointerdown', 360);
  pointer(handle, 'pointermove', 480);
  expect(handle.getAttribute('aria-valuenow')).toBe('480');
  expect(container.querySelector('.sidebar-resizing')).not.toBeNull();
  pointer(handle, 'pointermove', 900);
  expect(handle.getAttribute('aria-valuenow')).toBe('560');
  pointer(handle, 'pointermove', 280);
  expect(handle.getAttribute('aria-valuenow')).toBe('280');
  pointer(handle, 'pointermove', 270);
  expect(screen.getByRole('separator').getAttribute('aria-valuetext')).toBe(
    'Collapsed',
  );
  expect(container.querySelector('.sidebar-resizing')).not.toBeNull();
  expect(
    container
      .querySelector<HTMLElement>('.app-layout')
      ?.style.getPropertyValue('--sidebar-width'),
  ).toBe('270px');
  expect(release).not.toHaveBeenCalled();
  pointer(handle, 'pointermove', 320);
  expect(handle.getAttribute('aria-valuenow')).toBe('320');
  expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy();
  pointer(handle, 'pointermove', 200);
  expect(handle.getAttribute('aria-valuetext')).toBe('Collapsed');
  expect(
    container
      .querySelector<HTMLElement>('.app-layout')
      ?.style.getPropertyValue('--sidebar-width'),
  ).toBe('200px');
  pointer(handle, 'pointerup', 200);
  expect(release).toHaveBeenCalledOnce();
  expect(container.querySelector('.sidebar-resizing')).toBeNull();
  expect(
    container
      .querySelector<HTMLElement>('.app-layout')
      ?.style.getPropertyValue('--sidebar-width'),
  ).toBe('');
  expect(handle.getAttribute('aria-valuenow')).toBe('72');
  fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
  expect(handle.getAttribute('aria-valuenow')).toBe('320');
});

it('expands by dragging the collapsed edge and keeps resizing within the bounds', async () => {
  const { container } = await open();
  fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
  const handle = screen.getByRole('separator', { name: 'Resize sidebar' });
  Object.assign(handle, {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  });
  pointer(handle, 'pointerdown', 72);
  pointer(handle, 'pointermove', 78);
  expect(handle.getAttribute('aria-valuetext')).toBe('Collapsed');
  expect(handle.getAttribute('aria-valuenow')).toBe('78');
  pointer(handle, 'pointermove', 200);
  expect(handle.getAttribute('aria-valuenow')).toBe('200');
  expect(handle.getAttribute('aria-valuetext')).toBe('Collapsed');
  pointer(handle, 'pointermove', 280);
  expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy();
  expect(handle.getAttribute('aria-valuenow')).toBe('280');
  pointer(handle, 'pointermove', 400);
  expect(handle.getAttribute('aria-valuenow')).toBe('400');
  pointer(handle, 'pointermove', 900);
  expect(handle.getAttribute('aria-valuenow')).toBe('560');
  pointer(handle, 'pointerup', 900);
  expect(container.querySelector('.sidebar-resizing')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
  fireEvent.keyDown(handle, { key: 'ArrowRight' });
  expect(handle.getAttribute('aria-valuenow')).toBe('560');
});

it('preserves the grab offset and settles the rail when capture is lost', async () => {
  const { container } = await open();
  fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
  const handle = screen.getByRole('separator');
  Object.assign(handle, {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  });
  pointer(handle, 'pointerdown', 76);
  pointer(handle, 'pointermove', 304);
  expect(handle.getAttribute('aria-valuenow')).toBe('300');
  expect(
    container
      .querySelector<HTMLElement>('.app-layout')
      ?.style.getPropertyValue('--sidebar-width'),
  ).toBe('300px');
  pointer(handle, 'pointermove', 204);
  expect(handle.getAttribute('aria-valuenow')).toBe('200');
  pointer(handle, 'lostpointercapture', 204);
  expect(handle.getAttribute('aria-valuenow')).toBe('72');
  expect(container.querySelector('.sidebar-resizing')).toBeNull();
  pointer(handle, 'pointermove', 500);
  expect(handle.getAttribute('aria-valuetext')).toBe('Collapsed');
});

it('starts at the visible edge when grabbing during a collapse animation', async () => {
  const { container } = await open();
  fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
  const handle = screen.getByRole('separator');
  Object.assign(handle, {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  });
  vi.spyOn(handle, 'getBoundingClientRect').mockReturnValue({
    left: 196,
    right: 204,
    width: 8,
    height: 800,
    top: 0,
    bottom: 800,
    x: 196,
    y: 0,
    toJSON: () => ({}),
  });
  pointer(handle, 'pointerdown', 202);
  expect(
    container
      .querySelector<HTMLElement>('.app-layout')
      ?.style.getPropertyValue('--sidebar-width'),
  ).toBe('200px');
  pointer(handle, 'pointermove', 302);
  expect(handle.getAttribute('aria-valuenow')).toBe('300');
  pointer(handle, 'pointerup', 302);
  expect(handle.getAttribute('aria-valuenow')).toBe('300');
});
