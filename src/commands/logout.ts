import { Command } from "commander";
import { deleteAuth } from "../lib/auth.js";
import { log } from "../lib/logger.js";

export const logoutCommand = new Command("logout")
  .description("Remove stored authentication credentials")
  .action(() => {
    const deleted = deleteAuth();
    if (deleted) {
      log.success("Logged out successfully.");
    } else {
      log.info("Not currently logged in.");
    }
  });
