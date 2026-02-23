import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import type {
  RegistryItem,
  RegistryManifest,
  ItemPayload,
} from "../types/index.js";
import { registryItemSchema } from "./validator.js";
import { DEFAULT_BUILD_OUTPUT } from "./constants.js";

/**
 * Build upload payloads from a registry manifest by reading file contents from disk.
 */
export function buildPayloads(
  manifest: RegistryManifest,
  cwd: string = process.cwd(),
): ItemPayload[] {
  const payloads: ItemPayload[] = [];

  for (const item of manifest.items) {
    const payload = buildItemPayload(item, cwd);
    payloads.push(payload);
  }

  return payloads;
}

function buildItemPayload(item: RegistryItem, cwd: string): ItemPayload {
  // Read file contents from disk
  const files = item.files.map((file) => {
    if (file.content) {
      // Content already inline (e.g., from registry.json with inline content)
      return {
        path: file.path,
        type: file.type,
        content: file.content,
        target: file.target,
      };
    }

    const filePath = resolve(cwd, file.path);
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      throw new Error(
        `File not found: ${file.path}\n  Referenced by item '${item.name}' in registry.json`,
      );
    }

    return {
      path: file.path,
      type: file.type,
      content,
      target: file.target,
    };
  });

  // Handle css and meta serialization
  // shadcn spec allows objects, but Convex stores as string
  let css: string | undefined;
  if (item.css !== undefined) {
    css = typeof item.css === "object" ? JSON.stringify(item.css) : item.css;
  }

  let meta: string | undefined;
  if (item.meta !== undefined) {
    meta =
      typeof item.meta === "object" ? JSON.stringify(item.meta) : item.meta;
  }

  return {
    name: item.name,
    type: item.type,
    title: item.title,
    description: item.description,
    author: item.author,
    files,
    dependencies: item.dependencies,
    devDependencies: item.devDependencies,
    registryDependencies: item.registryDependencies,
    cssVars: item.cssVars,
    css,
    envVars: item.envVars,
    docs: item.docs,
    categories: item.categories,
    meta,
    extends: item.extends,
    style: item.style,
    iconLibrary: item.iconLibrary,
    baseColor: item.baseColor,
    itemTheme: item.theme, // shadcn "theme" → Convex "itemTheme"
    font: item.font,
  };
}

/**
 * Validate a payload against the Zod schema.
 * Returns null on success or an error message on failure.
 */
export function validatePayload(payload: ItemPayload): string | null {
  const result = registryItemSchema.safeParse(payload);
  if (result.success) return null;

  const issues = result.error.issues
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  return `Validation error in '${payload.name}':\n${issues}`;
}

/**
 * Chunk items into batches that fit within the max request size.
 */
export function chunkItems(items: ItemPayload[]): ItemPayload[][] {
  const MAX_BATCH_SIZE = 512 * 1024;
  const chunks: ItemPayload[][] = [];
  let currentChunk: ItemPayload[] = [];
  let currentSize = 0;

  for (const item of items) {
    const itemSize = JSON.stringify(item).length;
    if (currentSize + itemSize > MAX_BATCH_SIZE && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentSize = 0;
    }
    currentChunk.push(item);
    currentSize += itemSize;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Read item payloads from shadcn build output directory (public/r/).
 * Each JSON file (except registry.json) represents one registry item.
 */
export function readBuildOutput(
  cwd: string = process.cwd(),
  outputDir?: string,
): ItemPayload[] {
  const dir = resolve(cwd, outputDir ?? DEFAULT_BUILD_OUTPUT);

  if (!existsSync(dir)) {
    throw new Error(
      `Build output directory not found: ${outputDir ?? DEFAULT_BUILD_OUTPUT}\n` +
        `  Run \`shadcn build\` first to generate the registry output.`,
    );
  }

  const jsonFiles = readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "registry.json")
    .sort();

  if (jsonFiles.length === 0) {
    throw new Error(
      `No item JSON files found in ${outputDir ?? DEFAULT_BUILD_OUTPUT}.\n` +
        `  Run \`shadcn build\` first to generate the registry output.`,
    );
  }

  const payloads: ItemPayload[] = [];

  for (const file of jsonFiles) {
    const filePath = resolve(dir, file);
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      throw new Error(`Failed to read build output file: ${file}`);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`Invalid JSON in build output file: ${file}`);
    }

    // Map from shadcn build output format to our ItemPayload format
    const payload: ItemPayload = {
      name: parsed.name as string,
      type: parsed.type as string,
      title: parsed.title as string | undefined,
      description: parsed.description as string | undefined,
      author: parsed.author as string | undefined,
      files: (parsed.files as ItemPayload["files"]) ?? [],
      dependencies: parsed.dependencies as string[] | undefined,
      devDependencies: parsed.devDependencies as string[] | undefined,
      registryDependencies: parsed.registryDependencies as string[] | undefined,
      cssVars: parsed.cssVars as ItemPayload["cssVars"],
      css: parsed.css as string | undefined,
      envVars: parsed.envVars as Record<string, string> | undefined,
      docs: parsed.docs as string | undefined,
      categories: parsed.categories as string[] | undefined,
      meta: parsed.meta as string | undefined,
      extends: parsed.extends as string | undefined,
      style: parsed.style as string | undefined,
      iconLibrary: parsed.iconLibrary as string | undefined,
      baseColor: parsed.baseColor as string | undefined,
      itemTheme: parsed.theme as string | undefined,
      font: parsed.font as ItemPayload["font"],
    };

    payloads.push(payload);
  }

  return payloads;
}
