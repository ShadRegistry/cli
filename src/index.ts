import { Command } from "commander";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { initCommand } from "./commands/init.js";
import { publishCommand } from "./commands/publish.js";
import { addCommand } from "./commands/add.js";
import { listCommand } from "./commands/list.js";
import { diffCommand } from "./commands/diff.js";
import { scanCommand } from "./commands/scan.js";
import { updateCommand } from "./commands/update.js";
import { getVersion } from "./lib/version.js";
import {
  checkForUpdate,
  printUpdateNotification,
} from "./lib/update-check.js";

const program = new Command();

program
  .name("shadregistry")
  .description(
    "Publish and manage shadcn-compatible component registries on ShadRegistry",
  )
  .version(getVersion());

program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(initCommand);
program.addCommand(publishCommand);
program.addCommand(addCommand);
program.addCommand(listCommand);
program.addCommand(diffCommand);
program.addCommand(scanCommand);
program.addCommand(updateCommand);

// Start the update check concurrently with command execution
const updateCheckPromise = checkForUpdate();

// Suppress notification for update command and --version flag
const args = process.argv.slice(2);
const suppressNotification =
  args.includes("update") ||
  args.includes("--version") ||
  args.includes("-V");

// Show update notification after command completes
program.hook("postAction", async () => {
  if (suppressNotification) return;
  try {
    const latestVersion = await updateCheckPromise;
    if (latestVersion) {
      printUpdateNotification(latestVersion);
    }
  } catch {
    // Silently ignore update check errors
  }
});

program.parse();
