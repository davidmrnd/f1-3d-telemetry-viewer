export interface BoundsXZ {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface Node<T> extends BoundsXZ {
  items?: T[];
  left?: Node<T>;
  right?: Node<T>;
}

export function overlaps(a: BoundsXZ, b: BoundsXZ): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

export class SpatialIndex<T extends BoundsXZ> {
  private readonly root?: Node<T>;

  constructor(items: T[]) {
    if (items.length) this.root = this.build([...items]);
  }

  query(bounds: BoundsXZ): T[] {
    const result: T[] = [];
    const visit = (node?: Node<T>) => {
      if (!node || !overlaps(node, bounds)) return;
      if (node.items) {
        for (const item of node.items) if (overlaps(item, bounds)) result.push(item);
      } else {
        visit(node.left);
        visit(node.right);
      }
    };
    visit(this.root);
    return result;
  }

  nearest(x: number, z: number, distanceSq: (item: T) => number): T | undefined {
    let best: T | undefined;
    let bestDistance = Infinity;
    const boundDistance = (node: BoundsXZ) =>
      Math.max(node.minX - x, 0, x - node.maxX) ** 2 +
      Math.max(node.minZ - z, 0, z - node.maxZ) ** 2;
    const visit = (node?: Node<T>) => {
      if (!node || boundDistance(node) > bestDistance) return;
      if (node.items) {
        for (const item of node.items) {
          const distance = distanceSq(item);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = item;
          }
        }
      } else {
        const leftDistance = boundDistance(node.left!);
        const rightDistance = boundDistance(node.right!);
        visit(leftDistance < rightDistance ? node.left : node.right);
        visit(leftDistance < rightDistance ? node.right : node.left);
      }
    };
    visit(this.root);
    return best;
  }

  private build(items: T[]): Node<T> {
    const bounds = {
      minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity,
    };
    for (const item of items) {
      bounds.minX = Math.min(bounds.minX, item.minX);
      bounds.maxX = Math.max(bounds.maxX, item.maxX);
      bounds.minZ = Math.min(bounds.minZ, item.minZ);
      bounds.maxZ = Math.max(bounds.maxZ, item.maxZ);
    }
    if (items.length <= 8) return { ...bounds, items };
    const splitOnX = bounds.maxX - bounds.minX > bounds.maxZ - bounds.minZ;
    items.sort(splitOnX
      ? (a, b) => a.minX + a.maxX - b.minX - b.maxX
      : (a, b) => a.minZ + a.maxZ - b.minZ - b.maxZ);
    const middle = Math.floor(items.length / 2);
    return { ...bounds, left: this.build(items.slice(0, middle)), right: this.build(items.slice(middle)) };
  }
}
