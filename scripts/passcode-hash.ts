/**
 * Prints an APP_PASSCODE_HASH for the passcode typed at the prompt. The passcode itself is
 * never printed or written anywhere.
 */
import { createInterface } from "node:readline/promises";
import { hashPasscode } from "../src/auth/passcode";

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pass = (await rl.question("Passcode (8+ characters): ")).trim();
  rl.close();
  if (pass.length < 8) {
    console.error("Too short: use at least 8 characters.");
    process.exit(1);
  }
  console.log(`\nAPP_PASSCODE_HASH=${hashPasscode(pass)}`);
}

void main();
