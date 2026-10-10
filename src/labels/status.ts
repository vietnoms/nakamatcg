/**
 * The Zebra's answer to ~HS (host status), read back through Browser Print. Pure. Three blocks,
 * each between STX (\x02) and ETX (\x03), comma-separated (ZPL manual, ~HS):
 *   1: comm, paper out, PAUSED, label length, formats in buffer, buffer full, comm diag,
 *      partial format, unused, corrupt RAM, under temp, over temp
 *   2: function settings, unused, HEAD UP, RIBBON OUT, thermal transfer, print mode,
 *      width mode, label waiting, labels left in batch, format while printing, graphics
 *   3: password, static RAM
 */
export type HostStatus = {
  paperOut: boolean;
  paused: boolean;
  /** formats received but not printed yet */
  formatsWaiting: number;
  bufferFull: boolean;
  corruptRam: boolean;
  underTemp: boolean;
  overTemp: boolean;
  headOpen: boolean;
  ribbonOut: boolean;
  thermalTransfer: boolean;
  /** peel mode: a printed label is waiting to be taken */
  labelWaiting: boolean;
  labelsLeft: number;
};

export function parseHostStatus(text: string): HostStatus | null {
  const blocks = [...text.matchAll(/\x02([^\x03]*)\x03/g)].map((m) => (m[1] ?? "").split(",").map((s) => s.trim()));
  const [a, b] = blocks;
  if (!a || !b || a.length < 12 || b.length < 9) return null;
  const on = (v: string | undefined) => v === "1";
  return {
    paperOut: on(a[1]),
    paused: on(a[2]),
    formatsWaiting: Number.parseInt(a[4] ?? "0", 10) || 0,
    bufferFull: on(a[5]),
    corruptRam: on(a[9]),
    underTemp: on(a[10]),
    overTemp: on(a[11]),
    headOpen: on(b[2]),
    ribbonOut: on(b[3]),
    thermalTransfer: on(b[4]),
    labelWaiting: on(b[7]),
    labelsLeft: Number.parseInt(b[8] ?? "0", 10) || 0,
  };
}

/** What stops the printer, in plain words with the fix, most likely culprit first. Empty: nothing wrong. */
export function statusProblems(s: HostStatus): string[] {
  const out: string[] = [];
  if (s.headOpen) out.push("The print head is open. Close the lid until it clicks.");
  if (s.paperOut) out.push("It thinks it is out of labels. Check the roll, then Calibrate roll.");
  if (s.ribbonOut && s.thermalTransfer)
    out.push("It is set to use a ribbon and finds none. Direct thermal labels need no ribbon: set the printer's print method to direct thermal (or load a ribbon).");
  if (s.paused) out.push("The printer is paused, so it holds every sticker it is sent. Press Resume below (or the printer's pause button).");
  if (s.labelWaiting) out.push("A printed sticker is waiting to be taken (peel mode). Take it off.");
  if (s.bufferFull) out.push("Its memory is full of waiting jobs. Clear stuck jobs below.");
  if (s.overTemp) out.push("The print head is too hot. Let it cool for a few minutes.");
  if (s.underTemp) out.push("The printer is too cold to print.");
  if (s.corruptRam) out.push("The printer reports a memory error. Turn it off and on.");
  if (out.length === 0 && s.formatsWaiting > 0)
    out.push(`${s.formatsWaiting} sticker job(s) are sitting in the printer unprinted. Press Resume; if nothing comes out, Clear stuck jobs and try again.`);
  return out;
}
