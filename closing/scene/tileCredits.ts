/** Copyright strings supplied by the selected 3D tiles, never guessed locally. */
export function tileCredits(tiles: ReadonlyArray<{content?: unknown}>): string {
  const credits = new Set<string>();
  for (const tile of tiles) {
    const content = tile.content as {gltf?: {
      asset?: {copyright?: string}; json?: {asset?: {copyright?: string}};
    }} | undefined;
    const copyright = content?.gltf?.asset?.copyright ?? content?.gltf?.json?.asset?.copyright;
    if (typeof copyright !== 'string') continue;
    for (const item of copyright.split(';')) if (item.trim()) credits.add(item.trim());
  }
  return [...credits].sort().join('; ');
}
