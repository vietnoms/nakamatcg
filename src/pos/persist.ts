"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * State kept in localStorage, so a half-built cart survives a reload, the phone killing the app
 * in the background, or a sticker scanned with the camera app opening the POS again. Tabs stay
 * in step through the storage event. Falls back to plain state when storage is blocked.
 */
export function usePersistentState<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  const ref = useRef(value);

  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem(key);
        if (raw !== null) {
          ref.current = JSON.parse(raw) as T;
          setValue(ref.current);
        }
      } catch {
        // unreadable or blocked: keep what we have
      }
    };
    load();
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) load();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      ref.current = typeof next === "function" ? (next as (p: T) => T)(ref.current) : next;
      setValue(ref.current);
      try {
        localStorage.setItem(key, JSON.stringify(ref.current));
      } catch {
        // storage full or blocked: the state still works for this page
      }
    },
    [key],
  );

  return [value, set];
}

/** Reads a remembered value once, synchronously (for initial state in components mounted on the client). */
export function remembered<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function remember(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // fine
  }
}
