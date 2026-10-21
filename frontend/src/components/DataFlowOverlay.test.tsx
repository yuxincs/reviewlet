import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { flowColor } from '../flowColors';
import { DataFlowOverlay } from './DataFlowOverlay';
import type { GuideFlowNode } from '../demoReviewGuide';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('draws arrows in semantic order, including reverse flows, without crossing abstract nodes', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      if (this.dataset.reference === '1:1:5') return new DOMRect(50, 0, 40, 20);
      if (this.dataset.reference === '1:8:12')
        return new DOMRect(150, 0, 40, 20);
      return new DOMRect(0, 0, 500, 300);
    },
  );
  const source: GuideFlowNode = {
    label: 'source',
    flowKey: 'request.input',
    reference: {
      line: 1,
      startColumn: 1,
      endColumn: 5,
      symbol: 'from',
      role: 'source',
    },
  };
  const sink: GuideFlowNode = {
    label: 'sink',
    flowKey: 'handler.output',
    reference: {
      line: 1,
      startColumn: 8,
      endColumn: 12,
      symbol: 'to',
      role: 'sink',
    },
  };
  const view = (nodes: GuideFlowNode[]) => (
    <div>
      <mark data-reference="1:1:5">from</mark>
      <mark data-reference="1:8:12">to</mark>
      <DataFlowOverlay nodes={nodes} />
    </div>
  );
  const { container, rerender } = render(view([source, sink]));
  expect(
    container.querySelector('.data-flow-motion')?.getAttribute('d'),
  ).toMatch(/^M 95 10 C .*145 10$/);
  expect(
    container
      .querySelector<SVGGElement>('g.flow-color')
      ?.style.getPropertyValue('--flow-hue'),
  ).toBe(String(flowColor(sink)));
  rerender(view([sink, source]));
  expect(
    container
      .querySelector<SVGGElement>('g.flow-color')
      ?.style.getPropertyValue('--flow-hue'),
  ).toBe(String(flowColor(source)));
  expect(
    container.querySelector('.data-flow-motion')?.getAttribute('d'),
  ).toMatch(/^M 145 10 C .*95 10$/);
  rerender(view([source, { label: 'a proposed operation' }, sink]));
  expect(container.querySelector('.data-flow-motion')).toBeNull();
});
