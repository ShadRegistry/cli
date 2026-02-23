import { Command } from "commander";
import { log } from "../lib/logger.js";
import { resolveToken, resolveHostname } from "../lib/auth.js";
import { ApiClient } from "../lib/api-client.js";

export const listCommand = new Command("list")
  .description("List registries or items within a registry")
  .argument("[registry]", "Registry name to list items from")
  .option("--json", "Output as JSON", false)
  .option("--token <token>", "Override auth token")
  .action(async (registry: string | undefined, opts) => {
    const token = resolveToken(opts.token);
    if (!token) {
      log.error(
        "Not authenticated. Run `shadr login` or set SHADREGISTRY_TOKEN.",
      );
      process.exit(2);
    }

    const hostname = resolveHostname();
    const client = new ApiClient(hostname, token);

    if (registry) {
      await listItems(client, registry, opts.json);
    } else {
      await listRegistries(client, opts.json);
    }
  });

async function listRegistries(client: ApiClient, asJson: boolean) {
  try {
    const data = await client.get<{
      registries: Array<{
        name: string;
        displayName: string;
        description: string | null;
        isPrivate: boolean;
        totalInstalls: number;
      }>;
    }>("/api/cli/registries");

    if (asJson) {
      console.log(JSON.stringify(data.registries, null, 2));
      return;
    }

    if (data.registries.length === 0) {
      log.info("No registries found. Run `shadr init` to create one.");
      return;
    }

    // Print table header
    log.info(
      `${"NAME".padEnd(24)} ${"DISPLAY NAME".padEnd(24)} ${"PRIVATE".padEnd(10)} ${"INSTALLS".padEnd(10)}`,
    );
    log.dim("-".repeat(68));

    for (const r of data.registries) {
      log.info(
        `${r.name.padEnd(24)} ${r.displayName.padEnd(24)} ${(r.isPrivate ? "Yes" : "No").padEnd(10)} ${String(r.totalInstalls).padEnd(10)}`,
      );
    }
  } catch (e: any) {
    log.error(`Failed to list registries: ${e.message}`);
    process.exit(3);
  }
}

async function listItems(
  client: ApiClient,
  registry: string,
  asJson: boolean,
) {
  try {
    const data = await client.get<{
      items: Array<{
        name: string;
        type: string;
        title?: string;
        description?: string;
      }>;
    }>(`/api/cli/items?registry=${encodeURIComponent(registry)}`);

    if (asJson) {
      console.log(JSON.stringify(data.items, null, 2));
      return;
    }

    if (data.items.length === 0) {
      log.info(
        `No items in registry '${registry}'. Run \`shadr add <name>\` to add one.`,
      );
      return;
    }

    // Print table header
    log.info(
      `${"NAME".padEnd(24)} ${"TYPE".padEnd(24)} ${"TITLE".padEnd(24)}`,
    );
    log.dim("-".repeat(72));

    for (const item of data.items) {
      log.info(
        `${item.name.padEnd(24)} ${item.type.padEnd(24)} ${(item.title ?? "").padEnd(24)}`,
      );
    }
  } catch (e: any) {
    log.error(`Failed to list items: ${e.message}`);
    process.exit(3);
  }
}
