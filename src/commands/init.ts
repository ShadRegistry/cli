import { Command } from "commander";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { log } from "../lib/logger.js";
import { resolveToken, resolveHostname } from "../lib/auth.js";
import { ApiClient } from "../lib/api-client.js";
import {
  writeConfig,
  writeManifest,
  configExists,
  manifestExists,
} from "../lib/config.js";
import { DEFAULT_SOURCE_DIR } from "../lib/constants.js";

export const initCommand = new Command("init")
  .description("Initialize a local registry project")
  .option("--name <name>", "Registry name")
  .option("--display-name <name>", "Human-readable display name")
  .option("--private", "Mark registry as private", false)
  .option("--source-dir <dir>", "Source directory for components", DEFAULT_SOURCE_DIR)
  .option("-y, --yes", "Accept all defaults", false)
  .action(async (opts) => {
    const cwd = process.cwd();

    // Check existing config
    if (configExists(cwd) && !opts.yes) {
      const overwrite = await prompt(
        "A shadregistry.config.json already exists. Overwrite? (y/n) ",
      );
      if (overwrite.toLowerCase() !== "y") {
        log.info("Aborted.");
        return;
      }
    }

    const token = resolveToken();
    const hostname = resolveHostname();
    let registryName = opts.name;
    let displayName = opts.displayName;
    let isPrivate = opts.private;
    const sourceDir = opts.sourceDir;

    if (token) {
      // Authenticated — offer to select or create a registry
      const client = new ApiClient(hostname, token);

      try {
        const { registries } = await client.get<{
          registries: Array<{
            name: string;
            displayName: string;
            isPrivate: boolean;
          }>;
        }>("/api/cli/registries");

        let needsRemoteCreate = false;

        const existingRegistry = registryName
          ? registries.find((r) => r.name === registryName)
          : undefined;

        if (existingRegistry) {
          // --name matches an existing remote registry — use it
          displayName = displayName ?? existingRegistry.displayName;
          isPrivate = existingRegistry.isPrivate;
          log.success(`Using existing registry @${registryName}`);
        } else if (registryName) {
          // --name provided but doesn't exist remotely — need to create it
          needsRemoteCreate = true;
        } else if (registries.length > 0) {
          // No --name flag and user has registries — let them pick
          log.info("Your registries:");
          registries.forEach((r, i) => {
            log.info(
              `  ${i + 1}. ${r.name} ${r.isPrivate ? "(private)" : "(public)"}`,
            );
          });
          log.info(`  ${registries.length + 1}. Create a new registry`);
          log.newline();

          const choice = await prompt("Select a registry (number): ");
          const idx = parseInt(choice, 10) - 1;

          if (idx >= 0 && idx < registries.length) {
            registryName = registries[idx].name;
            displayName = registries[idx].displayName;
            isPrivate = registries[idx].isPrivate;
          } else {
            needsRemoteCreate = true;
          }
        } else {
          // No registries at all — need to create one
          needsRemoteCreate = true;
        }

        if (needsRemoteCreate) {
          if (!registryName) {
            registryName = await prompt("Registry name: ");
          }
          if (!displayName) {
            if (opts.yes) {
              displayName = toTitleCase(registryName);
            } else {
              displayName = await prompt(
                `Display name (${toTitleCase(registryName)}): `,
              );
              if (!displayName) displayName = toTitleCase(registryName);
            }
          }
          if (!opts.private && !opts.yes) {
            const privAnswer = await prompt("Private? (y/n, default: n): ");
            isPrivate = privAnswer.toLowerCase() === "y";
          }

          // Create on remote
          try {
            await client.post("/api/cli/registries/create", {
              name: registryName,
              displayName,
              isPrivate,
            });
            log.success(`Created registry @${registryName}`);
          } catch (e: any) {
            log.error(`Failed to create registry: ${e.message}`);
            process.exit(1);
          }
        }
      } catch {
        log.warn(
          "Could not fetch registries. Continuing with local-only setup.",
        );
      }
    }

    // Interactive prompts for unauthenticated users
    if (!registryName) {
      registryName = await prompt("Registry name: ");
    }
    if (!displayName) {
      displayName = toTitleCase(registryName);
    }

    // Write config
    writeConfig(
      {
        $schema: "https://shadregistry.com/schema/config.json",
        registry: registryName,
        sourceDir,
        url: hostname,
      },
      cwd,
    );

    // Write registry.json if it doesn't exist
    if (!manifestExists(cwd)) {
      writeManifest(
        {
          $schema: "https://ui.shadcn.com/schema/registry.json",
          name: registryName,
          homepage: "",
          items: [],
        },
        cwd,
      );
    }

    // Create source directory
    const srcDir = resolve(cwd, sourceDir);
    if (!existsSync(srcDir)) {
      mkdirSync(srcDir, { recursive: true });
    }

    log.newline();
    log.success("Initialized shadregistry project.");
    log.newline();
    log.info("Next steps:");
    log.info(`  shadregistry add my-component    # Scaffold a new component`);
    log.info(`  shadregistry publish              # Publish to the registry`);
  });

function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function toTitleCase(str: string): string {
  return str
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
