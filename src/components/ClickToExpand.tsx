// App-wide: any text that is cut off (Tailwind `line-clamp-*`, `truncate`, `text-ellipsis`) expands when clicked, and
// collapses on the next click, so a section never hides data the operator wants to read. One delegated listener instead of
// touching hundreds of components; the visual side lives in index.css ([data-clamped] / [data-expanded]).
//
// Rules that keep it from getting in the way:
//  - only text that is really cut off reacts (scroll size > client size), so short text is never touched
//  - anything inside a link, button or form control is left alone, so nav items and buttons still just click
//  - selecting text (drag) never toggles it
import { useEffect } from "react";

const CLAMPABLE = '[class*="line-clamp-"], .truncate, [class*="text-ellipsis"]';
const INTERACTIVE = 'a, button, input, textarea, select, label, summary, [role="button"], [role="tab"], [role="menuitem"], [contenteditable="true"]';

/** The nearest cut-off-able element at or above `target`, unless it sits inside something interactive. */
function clampableFrom(target: EventTarget | null): HTMLElement | null {
  const start = target instanceof Element ? target : null;
  const el = start?.closest<HTMLElement>(CLAMPABLE) ?? null;
  if (!el || el.closest(INTERACTIVE)) return null;
  return el;
}

function isCutOff(el: HTMLElement): boolean {
  if (el.dataset.expanded === "true") return true; // so a second click can collapse it again
  return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
}

export function ClickToExpand() {
  useEffect(() => {
    const onOver = (e: MouseEvent) => {
      const el = clampableFrom(e.target);
      if (!el) return;
      if (isCutOff(el)) el.dataset.clamped = "true";
      else delete el.dataset.clamped;
    };
    const onClick = (e: MouseEvent) => {
      if (window.getSelection()?.toString()) return; // the user was selecting text
      const el = clampableFrom(e.target);
      if (!el || !isCutOff(el)) return;
      el.dataset.expanded = el.dataset.expanded === "true" ? "false" : "true";
      el.dataset.clamped = "true";
    };
    document.addEventListener("mouseover", onOver, { passive: true });
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("click", onClick);
    };
  }, []);
  return null;
}
