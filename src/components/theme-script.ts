/** Light or dark, per browser. Shared by the root layout (server) and the toggle (client). */
export type Theme = "light" | "dark";

export const KEY = "nk:theme";
/** browser bar color per theme (meta theme-color) */
export const BAR: Record<Theme, string> = { light: "#fafafa", dark: "#09090b" };

/**
 * Runs inline in <head> before the first paint, so a reload never flashes the wrong theme.
 * Dark unless this browser picked light. Inline, not a file, so the offline POS needs nothing more.
 */
export const THEME_SCRIPT = `(function(){var t="dark";try{if(localStorage.getItem("${KEY}")==="light")t="light"}catch(e){}document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=t==="light"?"${BAR.light}":"${BAR.dark}"})()`;
