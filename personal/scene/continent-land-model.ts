export type LandPosition = [number, number];

export const CONTINENT_LAND_FILL_COLOR: [number, number, number, number] = [
  158,
  162,
  168,
  255,
];

type QuantizedPosition = [number, number];
type TopologyTransform = {
  scale: [number, number];
  translate: [number, number];
};
type TopologyPolygon = {
  type: "Polygon";
  arcs: number[][];
};
type TopologyMultiPolygon = {
  type: "MultiPolygon";
  arcs: number[][][];
};
type TopologyGeometryCollection = {
  type: "GeometryCollection";
  geometries: Array<TopologyPolygon | TopologyMultiPolygon>;
};

export type LandTopology = {
  type: "Topology";
  transform: TopologyTransform;
  arcs: QuantizedPosition[][];
  objects: {
    land: TopologyGeometryCollection | TopologyPolygon | TopologyMultiPolygon;
  };
};

export type ContinentLandPolygon = {
  id: string;
  polygon: LandPosition[][];
};

export function continentLandPolygons(
  topology: LandTopology
): ContinentLandPolygon[] {
  if (topology.type !== "Topology") {
    throw new Error("Continent land source must be TopoJSON topology.");
  }
  const decodedArcs = topology.arcs.map((arc) =>
    decodeArc(arc, topology.transform)
  );
  const geometries =
    topology.objects.land.type === "GeometryCollection"
      ? topology.objects.land.geometries
      : [topology.objects.land];
  const polygons = geometries.flatMap((geometry) =>
    geometry.type === "Polygon" ? [geometry.arcs] : geometry.arcs
  );

  return polygons.flatMap((rings, polygonIndex) => {
    const polygon = rings
      .map((arcReferences) => stitchRing(arcReferences, decodedArcs))
      .filter((ring) => ring.length >= 4);
    return polygon.length > 0 ? [{ id: `land-${polygonIndex}`, polygon }] : [];
  });
}

function decodeArc(
  arc: QuantizedPosition[],
  transform: TopologyTransform
): LandPosition[] {
  let x = 0;
  let y = 0;
  return arc.map(([deltaX, deltaY]) => {
    x += deltaX;
    y += deltaY;
    return [
      x * transform.scale[0] + transform.translate[0],
      y * transform.scale[1] + transform.translate[1],
    ];
  });
}

function stitchRing(
  arcReferences: number[],
  decodedArcs: LandPosition[][]
): LandPosition[] {
  const ring: LandPosition[] = [];
  for (const arcReference of arcReferences) {
    const arcIndex = arcReference < 0 ? ~arcReference : arcReference;
    const decoded = decodedArcs[arcIndex];
    if (!decoded)
      throw new Error(`Missing continent topology arc ${arcIndex}.`);
    const oriented = arcReference < 0 ? [...decoded].reverse() : decoded;
    ring.push(...oriented.slice(ring.length === 0 ? 0 : 1));
  }
  if (ring.length > 0 && !samePosition(ring[0], ring.at(-1)!)) {
    ring.push([...ring[0]]);
  }
  return ring;
}

function samePosition(left: LandPosition, right: LandPosition) {
  return left[0] === right[0] && left[1] === right[1];
}
