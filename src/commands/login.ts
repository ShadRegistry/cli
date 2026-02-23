import { Command } from "commander";
import open from "open";
import ora from "ora";
import { createInterface } from "node:readline";
import { log } from "../lib/logger.js";
import { readAuth, writeAuth, resolveHostname } from "../lib/auth.js";
import { ApiClient, createUnauthClient, ApiError } from "../lib/api-client.js";

export const loginCommand = new Command("login")
  .description("Authenticate with the ShadRegistry platform")
  .option("--with-token", "Read token from stdin instead of device auth")
  .option("--hostname <url>", "Override the ShadRegistry API base URL")
  .action(async (opts) => {
    const hostname = resolveHostname(opts.hostname);

    if (opts.withToken) {
      await loginWithToken(hostname);
    } else {
      await loginWithDeviceAuth(hostname);
    }
  });

async function loginWithToken(hostname: string) {
  // Read token from stdin
  const rl = createInterface({ input: process.stdin });
  const lines: string[] = [];
  for await (const line of rl) {
    lines.push(line.trim());
  }
  const token = lines.join("").trim();

  if (!token) {
    log.error("No token provided on stdin.");
    process.exit(2);
  }

  const client = new ApiClient(hostname, token);

  try {
    const whoami = await client.get<{
      username: string;
      tokenType: string;
    }>("/api/cli/whoami");

    writeAuth({
      token,
      user: { username: whoami.username },
      hostname,
    });

    log.success(`Logged in as @${whoami.username}`);
  } catch (e) {
    if (e instanceof ApiError) {
      log.error(`Authentication failed: ${e.message}`);
    } else {
      log.error("Authentication failed. Check your token and try again.");
    }
    process.exit(2);
  }
}

async function loginWithDeviceAuth(hostname: string) {
  // Check if already logged in
  const existing = readAuth();
  if (existing) {
    const client = new ApiClient(
      existing.hostname,
      existing.token,
    );
    try {
      const whoami = await client.get<{ username: string }>("/api/cli/whoami");
      log.info(
        `Already logged in as @${whoami.username}. Run \`shadregistry logout\` first to switch accounts.`,
      );
      return;
    } catch {
      // Token invalid, proceed with new login
    }
  }

  const unauthClient = createUnauthClient(hostname);

  // Step 1: Request device code
  let deviceData: {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };

  try {
    deviceData = await unauthClient.post("/api/cli/device/code", {});
  } catch (e) {
    log.error("Failed to start login flow. Is the server reachable?");
    process.exit(2);
  }

  // Step 2: Open browser with code pre-filled
  const verifyUrl = `${deviceData.verification_uri}?code=${encodeURIComponent(deviceData.user_code)}`;
  log.newline();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  await new Promise<void>((resolve) => {
    rl.question("Press Enter to open shadregistry.com in your browser... ", () => {
      rl.close();
      resolve();
    });
  });

  try {
    await open(verifyUrl);
    log.dim(`  If prompted, your code is: ${deviceData.user_code}`);
  } catch {
    log.newline();
    log.info(`! Your one-time code: ${deviceData.user_code}`);
    log.info(`  Open this URL: ${verifyUrl}`);
  }

  // Step 3: Poll for approval
  const spinner = ora("Waiting for authorization...").start();
  let interval = deviceData.interval * 1000;
  const deadline = Date.now() + deviceData.expires_in * 1000;

  while (Date.now() < deadline) {
    await sleep(interval);

    try {
      const result = await unauthClient.post<any>(
        "/api/cli/device/token",
        { device_code: deviceData.device_code },
      );

      if (result.error === "authorization_pending") {
        continue;
      }
      if (result.error === "slow_down") {
        interval += 5000;
        continue;
      }
      if (result.error === "expired_token") {
        spinner.fail("Code expired. Run `shadregistry login` again.");
        process.exit(2);
      }
      if (result.error) {
        spinner.fail(`Login failed: ${result.error}`);
        process.exit(2);
      }

      // Success!
      if (result.token) {
        spinner.stop();
        writeAuth({
          token: result.token,
          user: { username: result.user.username },
          hostname,
        });
        log.success(`Logged in as @${result.user.username}`);
        return;
      }
    } catch (e) {
      // Network error, keep polling
    }
  }

  spinner.fail("Login timed out. Run `shadregistry login` again.");
  process.exit(2);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
