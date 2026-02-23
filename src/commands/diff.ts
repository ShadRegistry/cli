import { Command } from "commander";
import { log } from "../lib/logger.js";
import { resolveToken, resolveHostname } from "../lib/auth.js";
import { readConfig } from "../lib/config.js";
import { ApiClient } from "../lib/api-client.js";
import { readBuildOutput, validatePayload } from "../lib/registry-builder.js";
import {
  computeDiff,
  formatDiffSummary,
  formatItemDiff,
} from "../lib/diff-utils.js";
import type { ItemPayload } from "../types/index.js";

export const diffCommand = new Command("diff")
  .description("Show what would change if publish were run")
  .option("--filter <names>", "Only diff specific items (comma-separated)")
  .option("--json", "Output diff as JSON", false)
  .option("--token <token>", "Override auth token")
  .option("--output <dir>", "Build output directory", "public/r")
  .action(async (opts) => {
    const cwd = process.cwd();

    // Auth
    const token = resolveToken(opts.token);
    if (!token) {
      log.error(
        "Not authenticated. Run `shadregistry login` or set SHADREGISTRY_TOKEN.",
      );
      process.exit(2);
    }

    // Config
    const config = readConfig(cwd);
    if (!config) {
      log.error(
        "No shadregistry.config.json found. Run `shadregistry init` first.",
      );
      process.exit(1);
    }

    // Read build output
    let payloads: ItemPayload[];
    try {
      payloads = readBuildOutput(cwd, opts.output);
    } catch (e: any) {
      log.error(e.message);
      process.exit(1);
    }

    // Validate
    for (const payload of payloads) {
      const err = validatePayload(payload);
      if (err) {
        log.error(err);
        process.exit(1);
      }
    }

    // Apply filter
    if (opts.filter) {
      const filterNames = new Set(
        (opts.filter as string).split(",").map((s: string) => s.trim()),
      );
      payloads = payloads.filter((p) => filterNames.has(p.name));
    }

    // Fetch remote state
    const hostname = resolveHostname();
    const client = new ApiClient(hostname, token);

    let remoteItems: ItemPayload[];
    try {
      const data = await client.get<{ items: ItemPayload[] }>(
        `/api/cli/items?registry=${encodeURIComponent(config.registry)}`,
      );
      remoteItems = data.items;
    } catch (e: any) {
      log.error(`Failed to fetch remote items: ${e.message}`);
      process.exit(3);
    }

    // Compute diff
    const diff = computeDiff(payloads, remoteItems);

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            new: diff.newItems.map((i) => i.name),
            updated: diff.updatedItems.map((i) => i.name),
            unchanged: diff.unchangedNames,
            orphaned: diff.orphanedNames,
          },
          null,
          2,
        ),
      );
      return;
    }

    // Display summary
    log.bold(`Diff for @${config.registry}`);
    log.newline();
    log.info(formatDiffSummary(diff, config.registry));

    // Show detailed diffs for updated items
    if (diff.updatedItems.length > 0) {
      log.newline();
      const remoteByName = new Map(remoteItems.map((i) => [i.name, i]));
      for (const item of diff.updatedItems) {
        const remote = remoteByName.get(item.name);
        if (remote) {
          log.dim(formatItemDiff(item, remote));
        }
      }
    }
  });
