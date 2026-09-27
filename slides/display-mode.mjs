export function displayMode(search) {
  const query = new URLSearchParams(search);
  return {presenting: !query.has('studio'), reviewing: !query.has('studio') && (query.has('script') || query.has('edit'))};
}
