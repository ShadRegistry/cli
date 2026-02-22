import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { AUTH_DIR, AUTH_FILE, TOKEN_PREFIX_PAT, TOKEN_PREFIX_SKEY } from "./constants.js";
import type { AuthConfig } from "../types/index.js";

function getAuthPath(): string {
  return join(homedir(), AUTH_DIR, AUTH_FILE);
}

function getAuthDir(): string {
  return join(homedir(), AUTH_DIR);
}

export function readAuth(): AuthConfig | null {
  const authPath = getAuthPath();
  if (!existsSync(authPath)) return null;

  try {
    const content = readFileSync(authPath, "utf-8");
    return JSON.parse(content) as AuthConfig;
  } catch {
    return null;
  }
}

export function writeAuth(config: AuthConfig): void {
  const dir = getAuthDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  writeFileSync(getAuthPath(), JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

export function deleteAuth(): boolean {
  const authPath = getAuthPath();
  if (!existsSync(authPath)) return false;
  unlinkSync(authPath);
  return true;
}

export function resolveToken(flagToken?: string): string | null {
  // Priority: flag > env > auth file
  if (flagToken) return flagToken;

  const envToken = process.env.SHADREGISTRY_TOKEN;
  if (envToken) return envToken;

  const auth = readAuth();
  return auth?.token ?? null;
}

export function resolveHostname(flagHostname?: string): string {
  if (flagHostname) return flagHostname;

  const auth = readAuth();
  return auth?.hostname ?? "https://shadregistry.com";
}

export function getTokenType(token: string): "pat" | "skey" | "unknown" {
  if (token.startsWith(TOKEN_PREFIX_PAT)) return "pat";
  if (token.startsWith(TOKEN_PREFIX_SKEY)) return "skey";
  return "unknown";
}
