import { Command } from "commander";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { log } from "../lib/logger.js";
import { readConfig, readManifest, writeManifest } from "../lib/config.js";
import { VALID_TYPE_LIST } from "../lib/validator.js";

export const addCommand = new Command("add")
  .description("Scaffold a new component locally and add it to registry.json")
  .argument("<name>", "Name of the new item (e.g., cool-button)")
  .option(
    "--type <type>",
    "Item type (e.g., registry:component)",
    "registry:component",
  )
  .option("--title <title>", "Human-readable title")
  .option("--description <desc>", "Item description", "")
  .action(async (name: string, opts) => {
    const cwd = process.cwd();

    // Validate name
    if (name.length < 2 || name.length > 64) {
      log.error("Name must be between 2 and 64 characters.");
      process.exit(1);
    }
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) && name.length > 1) {
      log.error(
        "Name must be lowercase alphanumeric with hyphens, cannot start or end with a hyphen.",
      );
      process.exit(1);
    }

    // Validate type
    if (!VALID_TYPE_LIST.includes(opts.type as any)) {
      log.error(`Invalid type: ${opts.type}`);
      log.info(`Valid types: ${VALID_TYPE_LIST.join(", ")}`);
      process.exit(1);
    }

    // Read config
    const config = readConfig(cwd);
    if (!config) {
      log.error(
        "No shadregistry.config.json found. Run `shadregistry init` first.",
      );
      process.exit(1);
    }

    // Read manifest
    const manifest = readManifest(cwd);
    if (!manifest) {
      log.error("No registry.json found. Run `shadregistry init` first.");
      process.exit(1);
    }

    // Check for duplicate
    if (manifest.items.some((item) => item.name === name)) {
      log.error(`Item '${name}' already exists in registry.json.`);
      process.exit(1);
    }

    const sourceDir = config.sourceDir;
    const itemDir = resolve(cwd, sourceDir, name);
    const title = opts.title ?? toTitleCase(name);
    const type = opts.type as string;

    // Create directory
    if (!existsSync(itemDir)) {
      mkdirSync(itemDir, { recursive: true });
    }

    // Create starter files based on type
    const files: Array<{ path: string; type: string; target?: string }> = [];

    switch (type) {
      case "registry:component":
      case "registry:ui":
      case "registry:item": {
        const fileName = `${name}.tsx`;
        const filePath = join(sourceDir, name, fileName);
        writeFileSync(
          resolve(cwd, filePath),
          generateComponentTemplate(name, title),
        );
        files.push({ path: filePath, type });
        break;
      }

      case "registry:block": {
        const mainFile = `${name}.tsx`;
        const mainPath = join(sourceDir, name, mainFile);
        writeFileSync(
          resolve(cwd, mainPath),
          generateComponentTemplate(name, title),
        );
        files.push({ path: mainPath, type: "registry:component" });
        break;
      }

      case "registry:hook": {
        const hookName = name.startsWith("use-") ? name : `use-${name}`;
        const fileName = `${hookName}.ts`;
        const filePath = join(sourceDir, name, fileName);
        writeFileSync(
          resolve(cwd, filePath),
          generateHookTemplate(hookName),
        );
        files.push({ path: filePath, type });
        break;
      }

      case "registry:lib": {
        const fileName = `${name}.ts`;
        const filePath = join(sourceDir, name, fileName);
        writeFileSync(
          resolve(cwd, filePath),
          generateLibTemplate(name),
        );
        files.push({ path: filePath, type });
        break;
      }

      case "registry:page": {
        const fileName = "page.tsx";
        const filePath = join(sourceDir, name, fileName);
        writeFileSync(
          resolve(cwd, filePath),
          generatePageTemplate(name, title),
        );
        files.push({ path: filePath, type, target: "" });
        break;
      }

      case "registry:file": {
        const fileName = `${name}.ts`;
        const filePath = join(sourceDir, name, fileName);
        writeFileSync(resolve(cwd, filePath), `// ${name}\n`);
        files.push({ path: filePath, type, target: "" });
        break;
      }

      case "registry:style":
      case "registry:theme":
        // No source files for style/theme items
        break;
    }

    // Add to manifest
    manifest.items.push({
      name,
      type,
      title,
      description: opts.description || undefined,
      files,
    });

    writeManifest(manifest, cwd);

    log.newline();
    if (files.length > 0) {
      log.success(`Created ${name} in ${sourceDir}/${name}/`);
    } else {
      log.success(`Added ${name} to registry.json`);
    }
    log.info("Added to registry.json");
    log.newline();
    log.info("Edit your files, then run:");
    log.info("  shadregistry publish");
  });

function toTitleCase(str: string): string {
  return str
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function toPascalCase(str: string): string {
  return str
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function generateComponentTemplate(name: string, title: string): string {
  const componentName = toPascalCase(name);
  return `export function ${componentName}() {
  return (
    <div>
      <p>${title} component</p>
    </div>
  );
}
`;
}

function generateHookTemplate(hookName: string): string {
  const fnName = toCamelCase(hookName);
  return `import { useState } from "react";

export function ${fnName}() {
  const [state, setState] = useState(false);
  return { state, setState };
}
`;
}

function generateLibTemplate(name: string): string {
  const fnName = toCamelCase(name);
  return `export function ${fnName}() {
  // TODO: implement
}
`;
}

function generatePageTemplate(name: string, title: string): string {
  const componentName = toPascalCase(name);
  return `export default function ${componentName}Page() {
  return (
    <div>
      <h1>${title}</h1>
    </div>
  );
}
`;
}
