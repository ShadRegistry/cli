import { Command } from "commander";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { initCommand } from "./commands/init.js";
import { publishCommand } from "./commands/publish.js";
import { addCommand } from "./commands/add.js";
import { listCommand } from "./commands/list.js";
import { diffCommand } from "./commands/diff.js";
import { VERSION } from "./lib/constants.js";

const program = new Command();

program
  .name("shadregistry")
  .description(
    "Publish and manage shadcn-compatible component registries on ShadRegistry",
  )
  .version(VERSION);

program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(initCommand);
program.addCommand(publishCommand);
program.addCommand(addCommand);
program.addCommand(listCommand);
program.addCommand(diffCommand);

program.parse();
