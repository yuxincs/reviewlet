import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeToggle } from './ThemeToggle';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.dataset.theme = 'dark';
});

describe('theme preference', () => {
  it('defaults to dark mode', () => {
    render(<ThemeToggle />);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(
      screen.getByRole('button', { name: 'Switch to light mode' }),
    ).toBeTruthy();
  });

  it('switches themes and restores the saved preference on remount', () => {
    render(<ThemeToggle />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Switch to light mode' }),
    );
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('reviewlet.theme')).toBe('light');
    cleanup();
    render(<ThemeToggle />);
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.click(
      screen.getByRole('button', { name: 'Switch to dark mode' }),
    );
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('reviewlet.theme')).toBe('dark');
  });

  it('falls back to dark for an invalid stored preference', () => {
    localStorage.setItem('reviewlet.theme', 'unknown');
    render(<ThemeToggle />);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('allows switching themes when browser storage is disabled', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage disabled');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage disabled');
    });
    render(<ThemeToggle />);
    expect(document.documentElement.dataset.theme).toBe('dark');
    fireEvent.click(
      screen.getByRole('button', { name: 'Switch to light mode' }),
    );
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
