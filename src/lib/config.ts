import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { CONFIG_FILE, REGISTRY_FILE } from "./constants.js";
import type { ProjectConfig, RegistryManifest } from "../types/index.js";

export function readConfig(cwd: string = process.cwd()): ProjectConfig | null {
  const configPath = resolve(cwd, CONFIG_FILE);
  if (!existsSync(configPath)) return null;

  try {
    const content = readFileSync(configPath, "utf-8");
    return JSON.parse(content) as ProjectConfig;
  } catch {
    return null;
  }
}

export function writeConfig(
  config: ProjectConfig,
  cwd: string = process.cwd(),
): void {
  const configPath = resolve(cwd, CONFIG_FILE);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

export function readManifest(
  cwd: string = process.cwd(),
): RegistryManifest | null {
  const manifestPath = resolve(cwd, REGISTRY_FILE);
  if (!existsSync(manifestPath)) return null;

  try {
    const content = readFileSync(manifestPath, "utf-8");
    return JSON.parse(content) as RegistryManifest;
  } catch {
    return null;
  }
}

export function writeManifest(
  manifest: RegistryManifest,
  cwd: string = process.cwd(),
): void {
  const manifestPath = resolve(cwd, REGISTRY_FILE);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

export function configExists(cwd: string = process.cwd()): boolean {
  return existsSync(resolve(cwd, CONFIG_FILE));
}

export function manifestExists(cwd: string = process.cwd()): boolean {
  return existsSync(resolve(cwd, REGISTRY_FILE));
}
