/**
 * Sets the production login passcode: asks for it twice (not echoed), hashes it, and hands only
 * the hash to `vercel env add APP_PASSCODE_HASH production`. The passcode is never printed,
 * written to disk, or sent anywhere. Redeploy afterwards for it to take effect.
 */
import { spawnSync } from "node:child_process";
import { hashPasscode } from "../src/auth/passcode";

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (c === "\u0003") process.exit(130); // Ctrl+C
        if (c === "\u007f" || c === "\b") {
          if (value) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        value += c;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const first = await ask("New passcode (8+ characters): ");
  if (first.length < 8) {
    console.error("Too short: use at least 8 characters.");
    process.exit(1);
  }
  if ((await ask("Again: ")) !== first) {
    console.error("They don't match. Nothing changed.");
    process.exit(1);
  }
  const hash = hashPasscode(first);
  // replace any earlier value, then add the new one
  spawnSync("vercel", ["env", "rm", "APP_PASSCODE_HASH", "production", "--yes", "--scope", "vietnoms-projects"], { stdio: "ignore", shell: true });
  const res = spawnSync("vercel", ["env", "add", "APP_PASSCODE_HASH", "production", "--sensitive", "--scope", "vietnoms-projects"], {
    input: hash,
    stdio: ["pipe", "ignore", "inherit"],
    shell: true,
  });
  if (res.status !== 0) {
    console.error("vercel env add failed. Is the Vercel CLI signed in (vercel whoami)?");
    process.exit(1);
  }
  console.log("APP_PASSCODE_HASH set for production. Redeploy (or let the next deploy pick it up).");
}

void main();
