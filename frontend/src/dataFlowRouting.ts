export interface FlowPoint {
  x: number;
  y: number;
}
export interface FlowBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export interface FlowConnection {
  from: number;
  to: number;
}
export interface FlowRoute extends FlowConnection {
  points: FlowPoint[];
  path: string;
}
type Segment = [FlowPoint, FlowPoint];
const equal = (a: FlowPoint, b: FlowPoint) => a.x === b.x && a.y === b.y;
const distance = (a: FlowPoint, b: FlowPoint) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

// Penalize perpendicular crossings, including grid junctions, and parallel lane overlaps.
export function segmentsConflict([a, b]: Segment, [c, d]: Segment): boolean {
  const horizontal = a.y === b.y;
  const otherHorizontal = c.y === d.y;
  if (horizontal === otherHorizontal) {
    if ((horizontal && a.y !== c.y) || (!horizontal && a.x !== c.x))
      return false;
    const axis = horizontal ? 'x' : 'y';
    return (
      Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])) <
      Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]))
    );
  }
  const [h1, h2] = horizontal ? [a, b] : [c, d];
  const [v1, v2] = horizontal ? [c, d] : [a, b];
  return (
    v1.x >= Math.min(h1.x, h2.x) &&
    v1.x <= Math.max(h1.x, h2.x) &&
    h1.y >= Math.min(v1.y, v2.y) &&
    h1.y <= Math.max(v1.y, v2.y)
  );
}
const segments = (points: FlowPoint[]): Segment[] =>
  points.slice(1).map((point, index) => [points[index], point]);
function blocked(a: FlowPoint, b: FlowPoint, boxes: FlowBox[]): boolean {
  return boxes.some((box) =>
    a.y === b.y
      ? a.y > box.top &&
        a.y < box.bottom &&
        Math.max(a.x, b.x) > box.left &&
        Math.min(a.x, b.x) < box.right
      : a.x > box.left &&
        a.x < box.right &&
        Math.max(a.y, b.y) > box.top &&
        Math.min(a.y, b.y) < box.bottom,
  );
}
function simplify(points: FlowPoint[]): FlowPoint[] {
  return points.filter((point, index) => {
    const previous = points[index - 1],
      next = points[index + 1];
    return (
      !previous ||
      !next ||
      !(
        (previous.x === point.x && point.x === next.x) ||
        (previous.y === point.y && point.y === next.y)
      )
    );
  });
}
export function roundedFlowPath(points: FlowPoint[]): string {
  if (!points.length) return '';
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1],
      corner = points[index],
      next = points[index + 1];
    const radius = Math.min(
      5,
      distance(previous, corner) / 2,
      distance(corner, next) / 2,
    );
    const before = {
      x: corner.x + Math.sign(previous.x - corner.x) * radius,
      y: corner.y + Math.sign(previous.y - corner.y) * radius,
    };
    const after = {
      x: corner.x + Math.sign(next.x - corner.x) * radius,
      y: corner.y + Math.sign(next.y - corner.y) * radius,
    };
    path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
  }
  const last = points.at(-1)!;
  return `${path} L ${last.x} ${last.y}`;
}

function orientation(a: FlowPoint, b: FlowPoint, c: FlowPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function intersects(
  a: FlowPoint,
  b: FlowPoint,
  c: FlowPoint,
  d: FlowPoint,
): boolean {
  if (
    Math.max(a.x, b.x) < Math.min(c.x, d.x) ||
    Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
    Math.max(a.y, b.y) < Math.min(c.y, d.y) ||
    Math.max(c.y, d.y) < Math.min(a.y, b.y)
  )
    return false;
  return (
    orientation(a, b, c) * orientation(a, b, d) <= 0 &&
    orientation(c, d, a) * orientation(c, d, b) <= 0
  );
}
function intersectsBox(a: FlowPoint, b: FlowPoint, box: FlowBox): boolean {
  const inside = (point: FlowPoint) =>
    point.x > box.left &&
    point.x < box.right &&
    point.y > box.top &&
    point.y < box.bottom;
  if (inside(a) || inside(b)) return true;
  const corners = [
    { x: box.left, y: box.top },
    { x: box.right, y: box.top },
    { x: box.right, y: box.bottom },
    { x: box.left, y: box.bottom },
  ];
  return corners.some((point, index) =>
    intersects(a, b, point, corners[(index + 1) % 4]),
  );
}
function smoothCurve(
  points: FlowPoint[],
  obstacles: FlowBox[],
  existing: Segment[],
  width: number,
  height: number,
): { path: string; samples: FlowPoint[] } | undefined {
  const from = points[0],
    to = points.at(-1)!;
  const next = points[1],
    previous = points.at(-2)!;
  const reach = Math.min(100, Math.max(20, distance(from, to) / 2));
  for (const arch of [24, -24, 48, -48]) {
    const first = {
      x: from.x + Math.sign(next.x - from.x) * reach,
      y: from.y + Math.sign(next.y - from.y) * reach,
    };
    const second = {
      x: to.x - Math.sign(to.x - previous.x) * reach,
      y: to.y - Math.sign(to.y - previous.y) * reach,
    };
    if (from.y === to.y) {
      first.y += arch;
      second.y += arch;
    } else if (from.x === to.x) {
      first.x += arch;
      second.x += arch;
    }
    const samples = Array.from({ length: 65 }, (_, index) => {
      const t = index / 64,
        u = 1 - t;
      return {
        x:
          u ** 3 * from.x +
          3 * u ** 2 * t * first.x +
          3 * u * t ** 2 * second.x +
          t ** 3 * to.x,
        y:
          u ** 3 * from.y +
          3 * u ** 2 * t * first.y +
          3 * u * t ** 2 * second.y +
          t ** 3 * to.y,
      };
    });
    if (
      samples.some(
        (point) =>
          point.x < 4 ||
          point.x > width - 4 ||
          point.y < 4 ||
          point.y > height - 4,
      )
    )
      continue;
    const parts = segments(samples);
    if (
      parts.some(
        ([a, b]) =>
          obstacles.some((box) => intersectsBox(a, b, box)) ||
          existing.some(([c, d]) => intersects(a, b, c, d)),
      )
    )
      continue;
    return {
      path: `M ${from.x} ${from.y} C ${first.x} ${first.y}, ${second.x} ${second.y}, ${to.x} ${to.y}`,
      samples,
    };
  }
  return undefined;
}

interface SearchEntry {
  id: number;
  cost: number;
  score: number;
}
class MinHeap {
  items: SearchEntry[] = [];
  push(item: SearchEntry) {
    let index = this.items.length;
    this.items.push(item);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent].score <= item.score) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }
  pop(): SearchEntry | undefined {
    const first = this.items[0],
      last = this.items.pop();
    if (!this.items.length || !last) return first;
    let index = 0;
    while (index * 2 + 1 < this.items.length) {
      let child = index * 2 + 1;
      if (
        child + 1 < this.items.length &&
        this.items[child + 1].score < this.items[child].score
      )
        child++;
      if (last.score <= this.items[child].score) break;
      this.items[index] = this.items[child];
      index = child;
    }
    this.items[index] = last;
    return first;
  }
}
interface Port {
  point: FlowPoint;
  tip: FlowPoint;
}
function ports(box: FlowBox, width: number, height: number): Port[] {
  const x = (box.left + box.right) / 2,
    y = (box.top + box.bottom) / 2;
  return [
    { point: { x: box.left - 10, y }, tip: { x: box.left - 5, y } },
    { point: { x: box.right + 10, y }, tip: { x: box.right + 5, y } },
    { point: { x, y: box.top - 10 }, tip: { x, y: box.top - 5 } },
    { point: { x, y: box.bottom + 10 }, tip: { x, y: box.bottom + 5 } },
  ].filter(({ point, tip }) =>
    [point, tip].every(
      (p) => p.x >= 4 && p.x <= width - 4 && p.y >= 4 && p.y <= height - 4,
    ),
  );
}

// Orthogonal A*: four ports per symbol, obstacle clearance, bend cost and reserved route lanes.
export function routeDataFlows(
  boxes: (FlowBox | undefined)[],
  width: number,
  height: number,
  connections?: FlowConnection[],
): FlowRoute[] {
  const routes: FlowRoute[] = [];
  const reserved: Segment[] = [];
  const curveSegments: Segment[] = [];
  const obstacles = boxes
    .filter((box): box is FlowBox => Boolean(box))
    .map((box) => ({
      left: box.left - 4,
      right: box.right + 4,
      top: box.top - 4,
      bottom: box.bottom + 4,
    }));
  const edges =
    connections ??
    boxes.slice(1).map((_, index) => ({ from: index, to: index + 1 }));
  for (const edge of edges) {
    const source = boxes[edge.from],
      target = boxes[edge.to];
    if (!source || !target) continue;
    const starts = ports(source, width, height),
      goals = ports(target, width, height);
    if (!starts.length || !goals.length) continue;
    const allPorts = [...starts, ...goals];
    const xs = [
      ...new Set([
        8,
        width - 8,
        ...obstacles.flatMap((b) => [b.left - 6, b.right + 6]),
        ...allPorts.map((p) => p.point.x),
      ]),
    ]
      .filter((x) => x >= 4 && x <= width - 4)
      .sort((a, b) => a - b);
    const ys = [
      ...new Set([
        8,
        height - 8,
        ...obstacles.flatMap((b) => [b.top - 6, b.bottom + 6]),
        ...allPorts.map((p) => p.point.y),
      ]),
    ]
      .filter((y) => y >= 4 && y <= height - 4)
      .sort((a, b) => a - b);
    const pointAt = (id: number): FlowPoint => {
      const cell = Math.floor(id / 3);
      return { x: xs[cell % xs.length], y: ys[Math.floor(cell / xs.length)] };
    };
    const cellAt = (p: FlowPoint) =>
      ys.indexOf(p.y) * xs.length + xs.indexOf(p.x);
    const costs = new Map<number, number>(),
      parents = new Map<number, number>();
    const origins = new Map<number, Port>();
    const heap = new MinHeap();
    const heuristic = (point: FlowPoint) =>
      Math.min(...goals.map((goal) => distance(point, goal.point)));
    for (const port of starts) {
      if (blocked(port.tip, port.point, obstacles)) continue;
      const id = cellAt(port.point) * 3;
      costs.set(id, 0);
      origins.set(id, port);
      heap.push({ id, cost: 0, score: heuristic(port.point) });
    }
    let found: { id: number; goal: Port } | undefined;
    while (heap.items.length) {
      const current = heap.pop()!;
      if (current.cost !== costs.get(current.id)) continue;
      const point = pointAt(current.id);
      const goal = goals.find(
        (port) =>
          equal(port.point, point) && !blocked(point, port.tip, obstacles),
      );
      if (goal) {
        found = { id: current.id, goal };
        break;
      }
      const cell = Math.floor(current.id / 3),
        x = cell % xs.length,
        y = Math.floor(cell / xs.length);
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (nx < 0 || nx >= xs.length || ny < 0 || ny >= ys.length) continue;
        const next = { x: xs[nx], y: ys[ny] };
        if (blocked(point, next, obstacles)) continue;
        const direction = nx === x ? 2 : 1;
        const id = (ny * xs.length + nx) * 3 + direction;
        const turn = current.id % 3 && current.id % 3 !== direction ? 12 : 0;
        const conflicts = reserved.reduce(
          (sum, segment) =>
            sum + (segmentsConflict([point, next], segment) ? 1000 : 0),
          0,
        );
        const cost = current.cost + distance(point, next) + turn + conflicts;
        if (cost >= (costs.get(id) ?? Infinity)) continue;
        costs.set(id, cost);
        parents.set(id, current.id);
        origins.set(id, origins.get(current.id)!);
        heap.push({ id, cost, score: cost + heuristic(next) });
      }
    }
    if (!found) continue; // Omit impossible connections rather than drawing through a symbol.
    const points: FlowPoint[] = [found.goal.tip];
    let id: number | undefined = found.id;
    while (id !== undefined) {
      points.push(pointAt(id));
      id = parents.get(id);
    }
    points.push(origins.get(found.id)!.tip);
    points.reverse();
    const clean = simplify(points);
    reserved.push(...segments(clean));
    const curve = smoothCurve(clean, obstacles, curveSegments, width, height);
    curveSegments.push(...segments(curve?.samples ?? clean));
    routes.push({
      ...edge,
      points: clean,
      path: curve?.path ?? roundedFlowPath(clean),
    });
  }
  return routes;
}
