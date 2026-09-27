// Keep every identity while bounding texture memory for the whole organization.
// Anyone who can grow through commit credit keeps a full-resolution portrait.
export function createAvatarAtlasLayout(nodes) {
  const entries = nodes.map((node, index) => ({index,
    size: node.contributions?.some(event => event.count > 0) ? 128 : 32}));
  const area = entries.reduce((sum, entry) => sum + entry.size ** 2, 0);
  const width = Math.min(8192, Math.max(128, 2 ** Math.ceil(Math.log2(Math.sqrt(area || 1)))));
  let y = 0;
  const tiles = [];
  for (const size of [128, 32]) {
    const group = entries.filter(entry => entry.size === size);
    const columns = width / size;
    for (let offset = 0; offset < group.length; offset++) {
      tiles.push({...group[offset], x: offset % columns * size,
        y: y + Math.floor(offset / columns) * size});
    }
    y += Math.ceil(group.length / columns) * size;
  }
  if (y > 16384) throw new Error('Avatar atlas exceeds the verified texture bound; use multiple atlases.');
  return {width, height: Math.max(32, y), tiles: tiles.sort((left, right) => left.index - right.index)};
}
