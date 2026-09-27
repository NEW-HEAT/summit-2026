// Reject illustrative groves whose physical crown footprint crosses the land mask.
export function landContains(geojson) {
  const polygons = geojson.features.flatMap(f => f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : []).map(rings => ({
    rings, bounds: [Math.min(...rings[0].map(p => p[0])), Math.min(...rings[0].map(p => p[1])), Math.max(...rings[0].map(p => p[0])), Math.max(...rings[0].map(p => p[1]))]
  }));
  return ([x,y]) => polygons.some(({rings,bounds:b}) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && inRing([x,y],rings[0]) && !rings.slice(1).some(ring => inRing([x,y],ring)));
}
function inRing([x,y], ring) {
  let inside = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [xi,yi]=ring[i], [xj,yj]=ring[j];
    if ((yi>y)!==(yj>y) && x < (xj-xi)*(y-yi)/(yj-yi)+xi) inside=!inside;
  }
  return inside;
}
export function crownOnLand(tree, contains) {
  // Conservatively include canopy asymmetry and lean, in metres at this latitude.
  const radius=tree.canopyRadius*1.6, dy=radius/111320, dx=dy/Math.cos(tree.position[1]*Math.PI/180);
  return [-1,0,1].every(x => [-1,0,1].every(y => contains([tree.position[0]+x*dx,tree.position[1]+y*dy])));
}

// Detailed water polygons use the same public z14 MVT tiles as the visible map.
// At these local-map zooms MVT coordinates are normalized within the tile.
export function tileWaterFeatures(tile, coordinates = 'local') {
  if(tile.index.z!==14||!Array.isArray(tile.content))return [];
  const {x,y,z}=tile.index, n=2**z;
  const transform=coordinates=>typeof coordinates[0]==='number'
    ? [(x+coordinates[0])/n*360-180,Math.atan(Math.sinh(Math.PI*(1-2*(y+coordinates[1])/n)))*180/Math.PI]
    : coordinates.map(transform);
  return tile.content.filter(f=>f.properties?.layerName==='water'&&['Polygon','MultiPolygon'].includes(f.geometry?.type)).map(f=>({
    type:'Feature',properties:{},geometry:{type:f.geometry.type,coordinates:coordinates === 'wgs84' ? f.geometry.coordinates : transform(f.geometry.coordinates)}
  }));
}
