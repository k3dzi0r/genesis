/**
 * Siatka przestrzenna (counting sort) do wyszukiwania sąsiadów w O(n + zapytania·k),
 * zamiast naiwnego O(n²). Przebudowywana co tick — jest stanem pochodnym, nie zapisywanym.
 */
export class SpatialGrid {
  readonly nx: number;
  readonly ny: number;
  start: Int32Array;
  items: Int32Array;

  constructor(
    width: number,
    height: number,
    readonly cell: number,
    capacity: number,
  ) {
    this.nx = Math.max(1, Math.ceil(width / cell));
    this.ny = Math.max(1, Math.ceil(height / cell));
    this.start = new Int32Array(this.nx * this.ny + 1);
    this.items = new Int32Array(capacity);
  }

  build(x: Float64Array, y: Float64Array, n: number): void {
    const { nx, ny, cell, start, items } = this;
    start.fill(0);
    for (let i = 0; i < n; i++) {
      let cx = (x[i] / cell) | 0;
      let cy = (y[i] / cell) | 0;
      if (cx >= nx) cx = nx - 1;
      if (cy >= ny) cy = ny - 1;
      start[cy * nx + cx + 1]++;
    }
    for (let c = 0; c < nx * ny; c++) start[c + 1] += start[c];
    // wypełnianie z kursorami (kopia start jako pozycje zapisu)
    const cursor = this.cursor ?? (this.cursor = new Int32Array(nx * ny));
    cursor.set(start.subarray(0, nx * ny));
    for (let i = 0; i < n; i++) {
      let cx = (x[i] / cell) | 0;
      let cy = (y[i] / cell) | 0;
      if (cx >= nx) cx = nx - 1;
      if (cy >= ny) cy = ny - 1;
      items[cursor[cy * nx + cx]++] = i;
    }
  }

  private cursor: Int32Array | null = null;
}
