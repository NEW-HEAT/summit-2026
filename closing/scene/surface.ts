/** CPU height probe for the provider mesh. It returns height only, never location data. */
type MeshTriangle = [number[], number[], number[]];
const trianglesByContent = new WeakMap<object, MeshTriangle[]>();
let liveSurfaces: any[] = [];
let surfaceRevision = 0;

export function registerBridgeSurfaces(contents: any[]) {
  if (contents.length !== liveSurfaces.length || contents.some((content, index) => content !== liveSurfaces[index])) {
    liveSurfaces = contents;
    surfaceRevision++;
  }
}

export function bridgeSurfaceRevision() { return surfaceRevision; }

/** Restrict to the roadway height band: a railing/roof must never become the athlete's floor. */
export function roadHeightAt(coordinate: number[], expectedHeight: number): number | null {
  let highest = -Infinity;
  for (const content of liveSurfaces) {
    const origin = content?.cartographicOrigin;
    if (!origin || !content.gltf) continue;
    const distance = Math.hypot((coordinate[0] - origin[0]) * 111320 * Math.cos(origin[1] * Math.PI / 180), (coordinate[1] - origin[1]) * 110540);
    if (distance > 150) continue;
    const height = meshHeightAt(content, coordinate, expectedHeight - 0.8, expectedHeight + 0.45);
    if (height !== null) highest = Math.max(highest, height);
  }
  return Number.isFinite(highest) ? highest : null;
}

export function meshHeightAt(content: any, coordinate: number[], minHeight = -Infinity, maxHeight = Infinity): number | null {
  const origin = content?.cartographicOrigin;
  if (!origin || !coordinate) return null;
  const east = (coordinate[0] - origin[0]) * 111320 * Math.cos(origin[1] * Math.PI / 180);
  const north = (coordinate[1] - origin[1]) * 110540;
  const triangles = meshTriangles(content);
  let highest = -Infinity;
  for (const [a, b, c] of triangles) {
    const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(denominator) < 1e-8) continue;
    const u = ((b[1] - c[1]) * (east - c[0]) + (c[0] - b[0]) * (north - c[1])) / denominator;
    const v = ((c[1] - a[1]) * (east - c[0]) + (a[0] - c[0]) * (north - c[1])) / denominator;
    if (u >= 0 && v >= 0 && u + v <= 1) {
      const height = origin[2] + u * a[2] + v * b[2] + (1 - u - v) * c[2];
      if (height >= minHeight && height <= maxHeight) highest = Math.max(highest, height);
    }
  }
  return Number.isFinite(highest) ? highest : null;
}

function meshTriangles(content: any): MeshTriangle[] {
  const cached = trianglesByContent.get(content);
  if (cached) return cached;
  const triangles: MeshTriangle[] = [];
  const gltf = content.gltf;
  if (!gltf) return triangles;
  for (const node of gltf.nodes ?? []) {
    const mesh = typeof node.mesh === 'number' ? gltf.meshes[node.mesh] : node.mesh;
    for (const primitive of mesh?.primitives ?? []) {
      const positions = primitive.attributes?.POSITION?.value;
      const indices = primitive.indices?.value;
      if (!positions) continue;
      const vertices: number[][] = [];
      for (let i = 0; i < positions.length; i += 3) {
        const local = transform(node.matrix, [positions[i], positions[i + 1], positions[i + 2]]);
        vertices.push(transform(content.modelMatrix, local));
      }
      const count = indices?.length ?? vertices.length;
      for (let i = 0; i + 2 < count; i += 3) {
        const a = vertices[indices?.[i] ?? i];
        const b = vertices[indices?.[i + 1] ?? i + 1];
        const c = vertices[indices?.[i + 2] ?? i + 2];
        triangles.push([a, b, c]);
      }
    }
  }
  trianglesByContent.set(content, triangles);
  return triangles;
}

function transform(matrix: number[] | undefined, p: number[]): number[] {
  if (!matrix) return p;
  return [0, 1, 2].map(i => matrix[i] * p[0] + matrix[4 + i] * p[1] + matrix[8 + i] * p[2] + matrix[12 + i]);
}
