import { expect, it } from 'vitest';
import {
  routeDataFlows,
  segmentsConflict,
  type FlowPoint,
  type FlowBox,
} from './dataFlowRouting';
const segments = (points: FlowPoint[]): [FlowPoint, FlowPoint][] =>
  points.slice(1).map((point, index) => [points[index], point]);

it('routes around intervening symbol boxes with clearance and rounded corners', () => {
  const obstacle = { left: 130, right: 200, top: 70, bottom: 130 };
  const boxes: FlowBox[] = [
    { left: 30, right: 70, top: 90, bottom: 110 },
    obstacle,
    { left: 250, right: 290, top: 90, bottom: 110 },
  ];
  const [route] = routeDataFlows(boxes, 340, 220, [{ from: 0, to: 2 }]);
  expect(route).toBeTruthy();
  expect(route.path).toContain('Q');
  for (const [a, b] of segments(route.points)) {
    const hits =
      a.y === b.y
        ? a.y > obstacle.top - 4 &&
          a.y < obstacle.bottom + 4 &&
          Math.max(a.x, b.x) > obstacle.left - 4 &&
          Math.min(a.x, b.x) < obstacle.right + 4
        : a.x > obstacle.left - 4 &&
          a.x < obstacle.right + 4 &&
          Math.max(a.y, b.y) > obstacle.top - 4 &&
          Math.min(a.y, b.y) < obstacle.bottom + 4;
    expect(hits).toBe(false);
  }
});

it('chooses separate lanes for flows whose direct connections would cross', () => {
  const boxes: FlowBox[] = [
    { left: 50, right: 90, top: 60, bottom: 80 },
    { left: 340, right: 380, top: 260, bottom: 280 },
    { left: 340, right: 380, top: 60, bottom: 80 },
    { left: 50, right: 90, top: 260, bottom: 280 },
  ];
  const routes = routeDataFlows(boxes, 440, 340, [
    { from: 0, to: 1 },
    { from: 2, to: 3 },
  ]);
  expect(routes).toHaveLength(2);
  for (const first of segments(routes[0].points)) {
    for (const second of segments(routes[1].points))
      expect(segmentsConflict(first, second)).toBe(false);
  }
});

it('omits connections with missing or completely offscreen endpoints', () => {
  expect(
    routeDataFlows(
      [undefined, { left: 50, right: 80, top: 20, bottom: 40 }],
      200,
      100,
    ),
  ).toEqual([]);
  expect(
    routeDataFlows(
      [
        { left: -200, right: -150, top: -200, bottom: -180 },
        { left: 50, right: 80, top: 20, bottom: 40 },
      ],
      200,
      100,
    ),
  ).toEqual([]);
});
