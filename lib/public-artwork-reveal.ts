export function rememberArtworkReveal<T extends object>(
  revealedElements: WeakSet<T>,
  element: T,
): boolean {
  if (revealedElements.has(element)) return false;
  revealedElements.add(element);
  return true;
}
