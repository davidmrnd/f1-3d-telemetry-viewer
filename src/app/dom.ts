export function mustQuery<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Falta el elemento ${selector}`);
  }
  return element;
}
