import { Command } from "commander";
import { createInterface } from "node:readline";
import ora from "ora";
import { log } from "../lib/logger.js";
import { resolveToken, resolveHostname } from "../lib/auth.js";
import { readConfig, readManifest } from "../lib/config.js";
import { ApiClient } from "../lib/api-client.js";
import {
  buildPayloads,
  validatePayload,
  chunkItems,
} from "../lib/registry-builder.js";
import { computeDiff, formatDiffSummary } from "../lib/diff-utils.js";
import type { ItemPayload, PublishResult } from "../types/index.js";

export const publishCommand = new Command("publish")
  .description("Publish components to the remote registry")
  .option("--dry-run", "Show what would change without publishing", false)
  .option("--force", "Skip confirmation prompt", false)
  .option("--filter <names>", "Only publish specific items (comma-separated)")
  .option("--prune", "Delete remote items not present locally", false)
  .option("--token <token>", "Override auth token")
  .action(async (opts) => {
    const cwd = process.cwd();

    // Step 1: Resolve auth
    const token = resolveToken(opts.token);
    if (!token) {
      log.error(
        "Not authenticated. Run `shadregistry login` or set SHADREGISTRY_TOKEN.",
      );
      process.exit(2);
    }

    // Step 2: Read config
    const config = readConfig(cwd);
    if (!config) {
      log.error(
        "No shadregistry.config.json found. Run `shadregistry init` first.",
      );
      process.exit(1);
    }

    // Step 3: Read manifest
    const manifest = readManifest(cwd);
    if (!manifest || manifest.items.length === 0) {
      log.warn(
        "No items in registry.json. Run `shadregistry add <name>` first.",
      );
      process.exit(0);
    }

    // Step 4: Build payloads
    let payloads: ItemPayload[];
    try {
      payloads = buildPayloads(manifest, cwd);
    } catch (e: any) {
      log.error(e.message);
      process.exit(1);
    }

    // Validate each payload
    for (const payload of payloads) {
      const err = validatePayload(payload);
      if (err) {
        log.error(err);
        process.exit(1);
      }
    }

    // Step 5: Apply filter
    if (opts.filter) {
      const filterNames = new Set(
        (opts.filter as string).split(",").map((s: string) => s.trim()),
      );
      payloads = payloads.filter((p) => filterNames.has(p.name));

      // Warn about unmatched filters
      for (const name of filterNames) {
        if (!payloads.some((p) => p.name === name)) {
          log.warn(`Filter name '${name}' does not match any local item.`);
        }
      }
    }

    // Step 6: Fetch remote state
    const hostname = resolveHostname();
    const client = new ApiClient(hostname, token);

    let remoteItems: ItemPayload[];
    const spinner = ora("Fetching remote state...").start();
    try {
      const data = await client.get<{ items: ItemPayload[] }>(
        `/api/cli/items?registry=${encodeURIComponent(config.registry)}`,
      );
      remoteItems = data.items;
      spinner.stop();
    } catch (e: any) {
      spinner.fail(`Failed to fetch remote items: ${e.message}`);
      process.exit(3);
    }

    // Step 7: Compute diff
    const diff = computeDiff(payloads, remoteItems);

    // Step 8: Display summary
    log.bold(`Publishing to @${config.registry}`);
    log.newline();
    log.info(formatDiffSummary(diff, config.registry));

    const totalToPublish = diff.newItems.length + diff.updatedItems.length;

    // Step 9: Dry run exit
    if (opts.dryRun) {
      process.exit(0);
    }

    if (totalToPublish === 0 && (!opts.prune || diff.orphanedNames.length === 0)) {
      log.info("Nothing to publish.");
      process.exit(0);
    }

    // Step 10: Confirm
    if (!opts.force && totalToPublish > 0) {
      const answer = await prompt(
        `\nPublish ${totalToPublish} item${totalToPublish !== 1 ? "s" : ""}? (y/n) `,
      );
      if (answer.toLowerCase() !== "y") {
        log.info("Aborted.");
        process.exit(0);
      }
    }

    // Step 11: Upload
    if (totalToPublish > 0) {
      const itemsToPublish = [...diff.newItems, ...diff.updatedItems];
      const chunks = chunkItems(itemsToPublish);

      let totalCreated = 0;
      let totalUpdated = 0;
      const allErrors: Array<{ name: string; error: string }> = [];

      const uploadSpinner = ora("Publishing...").start();

      for (let i = 0; i < chunks.length; i++) {
        try {
          const result = await client.post<PublishResult>(
            "/api/cli/items/publish",
            {
              registry: config.registry,
              items: chunks[i],
            },
          );

          totalCreated += result.created;
          totalUpdated += result.updated;
          if (result.errors?.length) {
            allErrors.push(...result.errors);
          }
        } catch (e: any) {
          uploadSpinner.fail(`Upload failed: ${e.message}`);
          process.exit(3);
        }
      }

      uploadSpinner.stop();

      if (allErrors.length > 0) {
        log.warn("Some items had errors:");
        for (const err of allErrors) {
          log.error(`  ${err.name}: ${err.error}`);
        }
      }

      // Step 12: Prune
      if (opts.prune && diff.orphanedNames.length > 0) {
        if (!opts.force) {
          log.newline();
          log.info(
            `Deleting ${diff.orphanedNames.length} orphaned item${diff.orphanedNames.length !== 1 ? "s" : ""}: ${diff.orphanedNames.join(", ")}`,
          );
          const pruneAnswer = await prompt("Proceed? (y/n) ");
          if (pruneAnswer.toLowerCase() !== "y") {
            log.info("Skipped pruning.");
          } else {
            await pruneItems(client, config.registry, diff.orphanedNames);
          }
        } else {
          await pruneItems(client, config.registry, diff.orphanedNames);
        }
      }

      // Step 13: Success
      log.newline();
      log.success(
        `Published ${totalCreated + totalUpdated} item${totalCreated + totalUpdated !== 1 ? "s" : ""} to @${config.registry}`,
      );
      log.newline();

      for (const item of diff.newItems) {
        log.info(`  + ${item.name}  (created)`);
      }
      for (const item of diff.updatedItems) {
        log.info(`  ~ ${item.name}  (updated)`);
      }

      log.newline();
      log.dim(`Registry: ${hostname}/r/@${config.registry}/registry.json`);

      if (allErrors.length > 0) {
        process.exit(3);
      }
    } else if (opts.prune && diff.orphanedNames.length > 0) {
      // Only pruning, no publishes
      if (!opts.force) {
        log.newline();
        const pruneAnswer = await prompt(
          `Delete ${diff.orphanedNames.length} orphaned item${diff.orphanedNames.length !== 1 ? "s" : ""}? (y/n) `,
        );
        if (pruneAnswer.toLowerCase() !== "y") {
          log.info("Aborted.");
          process.exit(0);
        }
      }
      await pruneItems(client, config.registry, diff.orphanedNames);
      log.success(`Pruned ${diff.orphanedNames.length} orphaned items.`);
    }
  });

async function pruneItems(
  client: ApiClient,
  registry: string,
  names: string[],
) {
  try {
    await client.delete("/api/cli/items/delete", { registry, names });
  } catch (e: any) {
    log.error(`Failed to prune items: ${e.message}`);
  }
}

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
