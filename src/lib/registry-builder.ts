import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  RegistryItem,
  RegistryManifest,
  ItemPayload,
} from "../types/index.js";
import { registryItemSchema } from "./validator.js";

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
