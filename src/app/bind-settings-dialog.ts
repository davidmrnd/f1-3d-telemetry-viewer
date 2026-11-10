import { mustQuery } from "./dom";

export function bindSettingsDialog() {
  const dialog = mustQuery<HTMLDialogElement>("#settings-panel");
  const opener = mustQuery<HTMLButtonElement>("#settings-button");
  const tabs = Array.from(dialog.querySelectorAll<HTMLButtonElement>("[role=tab]"));
  const panels = tabs.map((tab) => mustQuery<HTMLElement>(`#${tab.getAttribute("aria-controls")}`));

  const selectTab = (index: number) => {
    tabs.forEach((tab, position) => {
      const active = position === index;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      panels[position].hidden = !active;
    });
  };
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener("click", () => selectTab(index));
    tab.addEventListener("keydown", (event) => {
      const destinations: Record<string, number> = {
        ArrowLeft: (index + tabs.length - 1) % tabs.length,
        ArrowRight: (index + 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1,
      };
      const next = destinations[event.key];
      if (typeof next !== "number") return;
      event.preventDefault();
      selectTab(next);
      tabs[next].focus();
    });
  }

  opener.addEventListener("click", () => {
    dialog.showModal();
    opener.setAttribute("aria-expanded", "true");
  });
  mustQuery("#settings-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    opener.setAttribute("aria-expanded", "false");
    opener.focus({ preventScroll: true });
  });

  const isBackdrop = (event: MouseEvent) => {
    if (event.target !== dialog) return false;
    const bounds = dialog.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom;
  };
  let pressedBackdrop = false;
  dialog.addEventListener("pointerdown", (event) => { pressedBackdrop = isBackdrop(event); });
  dialog.addEventListener("click", (event) => {
    if (pressedBackdrop && isBackdrop(event)) dialog.close();
    pressedBackdrop = false;
  });

  return dialog;
}
