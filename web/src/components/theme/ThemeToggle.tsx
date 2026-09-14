"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "hestia-theme";

/**
 * The chosen theme lives in the DOM — `data-theme` on <html> — with
 * localStorage as the persistence behind it. That attribute is the single
 * source of truth: ThemeScript sets it before first paint, and this component
 * reads it rather than keeping a parallel copy in React state.
 *
 * useSyncExternalStore is the right primitive for that: it handles the
 * server/client split without an effect that writes state during hydration.
 */

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  // Keep other tabs in step.
  window.addEventListener("storage", onChange);

  return () => {
    observer.disconnect();
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): Theme {
  const attribute = document.documentElement.getAttribute("data-theme");
  return attribute === "light" || attribute === "dark" ? attribute : "system";
}

/** The server cannot know the choice, so it renders the default. */
function getServerSnapshot(): Theme {
  return "system";
}

function choose(next: Theme) {
  const root = document.documentElement;

  if (next === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", next);

  try {
    if (next === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private browsing or blocked storage: the choice still applies to this
    // page view, it just will not be remembered.
  }
}

const OPTIONS: { value: Theme; label: string; title: string }[] = [
  { value: "light", label: "Light", title: "Always light" },
  { value: "dark", label: "Dark", title: "Always dark" },
  { value: "system", label: "Auto", title: "Follow the system setting" },
];

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex rounded-md border border-border p-0.5"
    >
      {OPTIONS.map((option) => {
        const active = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title}
            onClick={() => choose(option.value)}
            className={[
              "rounded px-2 py-1 text-xs transition",
              active
                ? "bg-accent-soft font-medium text-accent-strong"
                : "text-muted hover:text-foreground",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
