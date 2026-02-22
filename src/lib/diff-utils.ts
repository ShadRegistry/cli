import { createTwoFilesPatch } from "diff";
import pc from "picocolors";
import type { ItemPayload, DiffResult } from "../types/index.js";

/**
 * Compare local payloads against remote items and categorize them.
 */
export function computeDiff(
  localItems: ItemPayload[],
  remoteItems: ItemPayload[],
): DiffResult {
  const remoteByName = new Map<string, ItemPayload>();
  for (const item of remoteItems) {
    remoteByName.set(item.name, item);
  }

  const localNames = new Set(localItems.map((i) => i.name));

  const newItems: ItemPayload[] = [];
  const updatedItems: ItemPayload[] = [];
  const unchangedNames: string[] = [];

  for (const local of localItems) {
    const remote = remoteByName.get(local.name);
    if (!remote) {
      newItems.push(local);
    } else if (!deepEqual(local, remote)) {
      updatedItems.push(local);
    } else {
      unchangedNames.push(local.name);
    }
  }

  const orphanedNames = remoteItems
    .filter((r) => !localNames.has(r.name))
    .map((r) => r.name);

  return { newItems, updatedItems, unchangedNames, orphanedNames };
}

/**
 * Format a diff summary for display.
 */
export function formatDiffSummary(diff: DiffResult, _registryName: string): string {
  const lines: string[] = [];

  for (const item of diff.newItems) {
    lines.push(`  ${pc.green("+")} ${item.name.padEnd(24)} ${pc.dim("(new)")}`);
  }
  for (const item of diff.updatedItems) {
    lines.push(
      `  ${pc.yellow("~")} ${item.name.padEnd(24)} ${pc.dim("(updated)")}`,
    );
  }
  for (const name of diff.unchangedNames) {
    lines.push(
      `  ${pc.dim("=")} ${name.padEnd(24)} ${pc.dim("(unchanged)")}`,
    );
  }
  for (const name of diff.orphanedNames) {
    lines.push(
      `  ${pc.red("?")} ${name.padEnd(24)} ${pc.dim("(orphaned)")}`,
    );
  }

  const total = diff.newItems.length + diff.updatedItems.length;
  lines.push("");
  if (total > 0) {
    lines.push(
      `${total} item${total !== 1 ? "s" : ""} to publish (${diff.newItems.length} new, ${diff.updatedItems.length} updated)`,
    );
  } else {
    lines.push("No changes to publish.");
  }
  if (diff.orphanedNames.length > 0) {
    lines.push(
      `${diff.orphanedNames.length} item${diff.orphanedNames.length !== 1 ? "s" : ""} on remote not in local manifest (use --prune to delete)`,
    );
  }

  return lines.join("\n");
}

/**
 * Generate a unified diff between a remote and local item for display.
 */
export function formatItemDiff(
  localItem: ItemPayload,
  remoteItem: ItemPayload,
): string {
  const remoteJson = JSON.stringify(remoteItem, null, 2);
  const localJson = JSON.stringify(localItem, null, 2);
  return createTwoFilesPatch(
    `remote: ${localItem.name}`,
    `local: ${localItem.name}`,
    remoteJson,
    localJson,
    "",
    "",
  );
}

/**
 * Deep equality comparison for item payloads, ignoring undefined values.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined && b === undefined) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((val, idx) => deepEqual(val, b[idx]));
  }

  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    // Get all keys, filtering out undefined values
    const aKeys = Object.keys(aObj).filter((k) => aObj[k] !== undefined);
    const bKeys = Object.keys(bObj).filter((k) => bObj[k] !== undefined);

    if (aKeys.length !== bKeys.length) return false;

    const allKeys = new Set([...aKeys, ...bKeys]);
    for (const key of allKeys) {
      if (!deepEqual(aObj[key], bObj[key])) return false;
    }
    return true;
  }

  return false;
}
