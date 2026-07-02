#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname);
const appDataRoot = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, "RaybanWhatsAppCodexBridge")
  : path.resolve(repoRoot, ".local", "RaybanWhatsAppCodexBridge");
const defaultProfileDir = path.join(appDataRoot, "profile");
const defaultStatePath = path.join(appDataRoot, "state.json");
const defaultLogDir = path.join(appDataRoot, "logs");
const configPath = path.join(__dirname, "config.local.json");

function readLocalConfig() {
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid config.local.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const localConfig = readLocalConfig();

function cfgString(key, envName, fallback = "") {
  const envValue = process.env[envName];
  if (envValue != null && envValue !== "") return envValue;
  const value = localConfig[key];
  return typeof value === "string" ? value : fallback;
}

function cfgBool(key, envName, fallback = false) {
  const envValue = process.env[envName];
  if (envValue != null && envValue !== "") return envValue === "1" || envValue.toLowerCase() === "true";
  const value = localConfig[key];
  return typeof value === "boolean" ? value : fallback;
}

function cfgNumber(key, envName, fallback) {
  const envValue = process.env[envName];
  const raw = envValue != null && envValue !== "" ? envValue : localConfig[key];
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cfgStringArray(key, envName, fallback = []) {
  const envValue = process.env[envName];
  if (envValue != null && envValue !== "") {
    return envValue.split(",").map((item) => item.trim()).filter(Boolean);
  }
  const value = localConfig[key];
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : fallback;
}

function cfgRunnerArgs() {
  const rawJson = process.env.WHATSAPP_BRIDGE_RUNNER_ARGS_JSON;
  if (rawJson) return JSON.parse(rawJson);
  if (Array.isArray(localConfig.runnerArgs)) return localConfig.runnerArgs;
  return ["exec", "--skip-git-repo-check", "{{message}}"];
}

const config = {
  chatName: cfgString("chatName", "WHATSAPP_BRIDGE_CHAT"),
  chatPhone: cfgString("chatPhone", "WHATSAPP_BRIDGE_CHAT_PHONE"),
  commandPrefix: cfgString("commandPrefix", "WHATSAPP_BRIDGE_COMMAND_PREFIX", "ai"),
  backend: cfgString("backend", "WHATSAPP_BRIDGE_BACKEND", "command"),
  profileDir: path.resolve(cfgString("profileDir", "WHATSAPP_BRIDGE_PROFILE_DIR", defaultProfileDir)),
  statePath: path.resolve(cfgString("statePath", "WHATSAPP_BRIDGE_STATE_PATH", defaultStatePath)),
  logDir: path.resolve(cfgString("logDir", "WHATSAPP_BRIDGE_LOG_DIR", defaultLogDir)),
  pollMs: cfgNumber("pollMs", "WHATSAPP_BRIDGE_POLL_MS", 2500),
  replyMaxChars: cfgNumber("replyMaxChars", "WHATSAPP_BRIDGE_REPLY_MAX_CHARS", 900),
  commandTimeoutMs: cfgNumber("commandTimeoutMs", "WHATSAPP_BRIDGE_COMMAND_TIMEOUT_MS", 120000),
  runner: cfgString("runner", "WHATSAPP_BRIDGE_RUNNER", "codex"),
  runnerArgs: cfgRunnerArgs(),
  runnerCwd: path.resolve(repoRoot, cfgString("runnerCwd", "WHATSAPP_BRIDGE_RUNNER_CWD", ".")),
  paperclipWebhookUrl: cfgString("paperclipWebhookUrl", "WHATSAPP_BRIDGE_PAPERCLIP_WEBHOOK_URL"),
  processExisting: cfgBool("processExisting", "WHATSAPP_BRIDGE_PROCESS_EXISTING", false),
  allowOutgoingCommands: cfgBool("allowOutgoingCommands", "WHATSAPP_BRIDGE_ALLOW_OUTGOING", false),
  debug: cfgBool("debug", "WHATSAPP_BRIDGE_DEBUG", false),
  browserChannel: cfgString("browserChannel", "WHATSAPP_BRIDGE_BROWSER_CHANNEL", "chrome"),
  browserExecutable: cfgString("browserExecutable", "WHATSAPP_BRIDGE_BROWSER_EXECUTABLE"),
  voiceFriendly: cfgBool("voiceFriendly", "WHATSAPP_BRIDGE_VOICE_FRIENDLY", true),
  allowedSenderIncludes: cfgStringArray("allowedSenderIncludes", "WHATSAPP_BRIDGE_ALLOWED_SENDER_INCLUDES", []),
};

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Ray-Ban WhatsApp Codex Bridge

Config:
  config.local.json

Common commands:
  powershell -ExecutionPolicy Bypass -File start.ps1
  powershell -ExecutionPolicy Bypass -File status.ps1
  powershell -ExecutionPolicy Bypass -File stop.ps1

WhatsApp examples:
  ${config.commandPrefix} hi
  ${config.commandPrefix} status
  ${config.commandPrefix} summary
  ${config.commandPrefix} test
`);
  process.exit(0);
}

const smokeBrowserOnly = process.argv.includes("--smoke-browser");
let pendingApproval = null;

function info(message) {
  console.log(`[bridge] ${message}`);
}

function debug(message) {
  if (config.debug) console.log(`[bridge:debug] ${message}`);
}

function fail(message) {
  console.error(`[bridge] ${message}`);
  process.exitCode = 1;
}

function validateConfig() {
  if (!config.chatName && !config.chatPhone) {
    fail("Set chatPhone in config.local.json or WHATSAPP_BRIDGE_CHAT_PHONE.");
    return false;
  }
  if (!Array.isArray(config.runnerArgs) || !config.runnerArgs.every((item) => typeof item === "string")) {
    fail("runnerArgs must be an array of strings.");
    return false;
  }
  if (!Number.isFinite(config.pollMs) || config.pollMs < 1000) {
    fail("pollMs must be at least 1000.");
    return false;
  }
  if (config.backend === "paperclip-webhook" && !config.paperclipWebhookUrl) {
    fail("Set paperclipWebhookUrl for paperclip-webhook backend.");
    return false;
  }
  if (!["command", "paperclip-webhook", "echo"].includes(config.backend)) {
    fail("backend must be command, paperclip-webhook, or echo.");
    return false;
  }
  return true;
}

async function loadSeen() {
  try {
    const raw = await readFile(config.statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.seenKeys)) return new Set(parsed.seenKeys);
  } catch {
    // First run.
  }
  return new Set();
}

async function saveSeen(seenKeys) {
  await mkdir(path.dirname(config.statePath), { recursive: true });
  await writeFile(
    config.statePath,
    JSON.stringify({ seenKeys: [...seenKeys].slice(-500), updatedAt: new Date().toISOString() }, null, 2),
  );
}

async function openTargetChat(page) {
  if (config.chatPhone) {
    const phone = config.chatPhone.replace(/[^\d]/g, "");
    info(`Opening WhatsApp chat by phone: ${phone}`);
    await page.goto(`https://web.whatsapp.com/send?phone=${phone}`, { waitUntil: "domcontentloaded" });
  } else {
    info("Opening WhatsApp Web.");
    await page.goto("https://web.whatsapp.com/", { waitUntil: "domcontentloaded" });
  }

  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);

  if (config.chatName && !config.chatPhone) {
    await openChatBySearch(page, config.chatName);
  }

  await waitForMessagePane(page);
  info(`Current WhatsApp URL: ${page.url()}`);
}

async function openChatBySearch(page, chatName) {
  info(`Searching for chat: ${chatName}`);
  const searchSelectors = [
    'div[contenteditable="true"][role="textbox"][aria-label*="Search"]',
    'div[contenteditable="true"][data-tab="3"]',
    'div[contenteditable="true"]',
  ];

  let searchBox = null;
  for (const selector of searchSelectors) {
    const candidate = page.locator(selector).first();
    if (await candidate.count().catch(() => 0)) {
      searchBox = candidate;
      break;
    }
  }
  if (!searchBox) throw new Error("Could not find WhatsApp search box. Prefer chatPhone.");

  await searchBox.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.insertText(chatName);
  await page.waitForTimeout(1000);
  await page.getByText(chatName, { exact: false }).first().click();
}

async function waitForMessagePane(page) {
  info("Waiting for WhatsApp Web. Scan the QR code if this is the first launch.");
  await page.waitForFunction(() => {
    return Boolean(
      document.querySelector("footer div[contenteditable='true']") ||
        document.querySelector("[data-pre-plain-text]"),
    );
  }, undefined, { timeout: 0 });
  info("WhatsApp chat is ready.");
}

async function readMessages(page) {
  return page.$$eval("[data-pre-plain-text]", (nodes) => {
    return nodes.map((node, index) => {
      const element = node;
      const meta = element.getAttribute("data-pre-plain-text") ?? "";
      const text = (element.innerText || element.textContent || "")
        .replace(/\u200e/g, "")
        .replace(/\s+\n/g, "\n")
        .trim();
      const root = element.closest(".message-in, .message-out");
      const direction = root?.classList.contains("message-out") ? "out" : "in";
      return {
        index,
        key: `${meta}::${text}`,
        meta,
        text,
        direction,
      };
    });
  });
}

function extractCommand(messageText) {
  const prefix = config.commandPrefix.trim();
  if (!prefix) return messageText.trim();
  const normalized = messageText.trim();
  const lower = normalized.toLowerCase();
  const prefixLower = prefix.toLowerCase();
  if (lower === prefixLower) return "";
  if (!lower.startsWith(`${prefixLower} `) && !lower.startsWith(`${prefixLower}:`)) return null;
  return normalized.slice(prefix.length).replace(/^[:\s]+/, "").trim();
}

function senderAllowed(message) {
  if (config.allowedSenderIncludes.length === 0) return true;
  return config.allowedSenderIncludes.some((needle) => message.meta.includes(needle));
}

function classifyShortcut(command) {
  const normalized = command.trim().toLowerCase();
  if (["hi", "hello"].includes(normalized)) {
    return { kind: "reply", reply: "Hi. Bridge is online." };
  }
  if (normalized === "stop") {
    return { kind: "stop" };
  }
  if (normalized === "yes" || normalized === "y") {
    return { kind: "approval-yes" };
  }
  if (normalized === "no" || normalized === "n") {
    return { kind: "approval-no" };
  }
  if (normalized === "status") {
    return {
      kind: "codex",
      prompt: "Give a short WhatsApp-friendly project status. Check git status and mention only important changed/untracked files and whether the bridge appears configured.",
      safe: true,
    };
  }
  if (normalized === "summary") {
    return {
      kind: "codex",
      prompt: "Summarize this repository and the Ray-Ban WhatsApp bridge in 5 short bullets for a phone message.",
      safe: true,
    };
  }
  if (normalized === "test") {
    return {
      kind: "codex",
      prompt: "Run the repository's safest default test/check for the Ray-Ban WhatsApp bridge only if available. Keep the final answer short: pass/fail and key error.",
      safe: true,
    };
  }
  if (normalized === "continue") {
    return {
      kind: "codex",
      prompt: "Continue the last Ray-Ban WhatsApp bridge task if there is an obvious next step. If not, say what command I should send next.",
      safe: true,
    };
  }
  return { kind: "codex", prompt: command, safe: !requiresApproval(command) };
}

function requiresApproval(command) {
  const risky = [
    /\binstall\b/i,
    /\bdelete\b/i,
    /\bremove\b/i,
    /\brm\b/i,
    /\bshutdown\b/i,
    /\bpower\s*off\b/i,
    /\brestart\b/i,
    /\bgit\s+push\b/i,
    /\bgit\s+reset\b/i,
    /\bcommit\b/i,
    /\bedit\b/i,
    /\bmodify\b/i,
    /\bwrite\b/i,
    /\bimplement\b/i,
    /\bapply\s+patch\b/i,
  ];
  return risky.some((pattern) => pattern.test(command));
}

function buildCodexPrompt(command) {
  if (!config.voiceFriendly) return command;
  return [
    "You are replying through a Ray-Ban Meta WhatsApp bridge.",
    "Keep the final answer short, phone-friendly, and action-oriented.",
    "If you ran checks or edited files, state the result first.",
    "",
    `User command: ${command}`,
  ].join("\n");
}

async function runBackend(command, sourceMessage) {
  if (config.backend === "echo") {
    return { reply: `Bridge received: ${command}`, rawLogPath: null };
  }
  if (config.backend === "paperclip-webhook") {
    const reply = await firePaperclipWebhook(command, sourceMessage);
    return { reply, rawLogPath: null };
  }
  return runCommandBackend(buildCodexPrompt(command));
}

async function firePaperclipWebhook(command, sourceMessage) {
  const response = await fetch(config.paperclipWebhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: "rayban-whatsapp-bridge",
      command,
      whatsapp: {
        meta: sourceMessage.meta,
        text: sourceMessage.text,
      },
      receivedAt: new Date().toISOString(),
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Paperclip webhook failed: HTTP ${response.status} ${body}`);
  return `Paperclip accepted the request.\n${body.slice(0, config.replyMaxChars)}`;
}

function runnerArgsFor(command) {
  return config.runnerArgs.map((item) => item.replaceAll("{{message}}", command));
}

function runCommandBackend(command) {
  return new Promise((resolve, reject) => {
    const args = runnerArgsFor(command);
    info(`Running: ${config.runner} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`);
    const needsShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(config.runner);
    const child = spawn(config.runner, args, {
      cwd: config.runnerCwd,
      env: process.env,
      shell: needsShell,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const maxBuffer = 500_000;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Command timed out after ${config.commandTimeoutMs}ms`));
    }, config.commandTimeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk.toString()).slice(-maxBuffer);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-maxBuffer);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", async (code, signal) => {
      clearTimeout(timer);
      const raw = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n\n--- stderr ---\n\n");
      const rawLogPath = await writeRawOutput(command, raw || `Command exited with code ${code}${signal ? ` signal ${signal}` : ""}.`);
      const output = extractCodexReply(stdout) || stderr.trim() || `Command exited with code ${code}${signal ? ` signal ${signal}` : ""}.`;
      if (code === 0) {
        resolve({ reply: output, rawLogPath });
      } else {
        reject(new Error(`${output}\n\nFull log: ${rawLogPath}`));
      }
    });
  });
}

async function writeRawOutput(command, raw) {
  await mkdir(config.logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(config.logDir, `${stamp}.log`);
  await writeFile(filePath, `Command:\n${command}\n\nOutput:\n${raw}\n`, "utf8");
  return filePath;
}

function extractCodexReply(stdout) {
  const text = stripAnsi(stdout).trim();
  if (!text) return "";
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const codexMarker = lines.lastIndexOf("codex");
  const tokenMarker = lines.findIndex((line, index) => index > codexMarker && line.toLowerCase() === "tokens used");
  if (codexMarker >= 0 && tokenMarker > codexMarker + 1) {
    return lines.slice(codexMarker + 1, tokenMarker).join("\n").trim();
  }
  const noise = [
    /^20\d\d-\d\d-\d\dT/,
    /^OpenAI Codex /,
    /^workdir:/,
    /^model:/,
    /^provider:/,
    /^approval:/,
    /^sandbox:/,
    /^reasoning /,
    /^session id:/,
    /^user$/,
    /^Reading additional input/,
    /^tokens used$/i,
    /^\d[\d,]*$/,
    /^-+$/,
  ];
  return lines.filter((line) => !noise.some((pattern) => pattern.test(line))).join("\n").trim();
}

function stripAnsi(input) {
  return input.replace(/\u001b\[[0-9;]*m/g, "");
}

function formatReply(reply, rawLogPath = null) {
  const text = String(reply ?? "").trim() || "Done.";
  const suffix = rawLogPath ? `\n\nFull output saved on laptop.` : "";
  const max = Math.max(120, config.replyMaxChars - suffix.length);
  if (text.length <= max) return `${text}${suffix}`;
  return `${text.slice(0, max - 70)}\n\n[shortened for WhatsApp; full output saved on laptop]${suffix}`;
}

async function sendWhatsAppMessage(page, text, rawLogPath = null) {
  const chunks = chunkText(formatReply(text, rawLogPath), 3500);
  for (const chunk of chunks) {
    const input = page.locator("footer div[contenteditable='true'][role='textbox']").last();
    await input.waitFor({ timeout: 30_000 });
    await input.click();
    await page.keyboard.insertText(chunk);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
  }
}

function chunkText(text, size) {
  const chunks = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks.length ? chunks : ["Done."];
}

async function handleCommand(page, command, message) {
  const shortcut = classifyShortcut(command);
  if (shortcut.kind === "reply") {
    await sendWhatsAppMessage(page, shortcut.reply);
    return;
  }
  if (shortcut.kind === "approval-yes") {
    if (!pendingApproval) {
      await sendWhatsAppMessage(page, "No pending approval.");
      return;
    }
    const approved = pendingApproval;
    pendingApproval = null;
    await sendWhatsAppMessage(page, `Approved. Running: ${approved.original}`);
    const result = await runBackend(approved.prompt, message);
    await sendWhatsAppMessage(page, result.reply, result.rawLogPath);
    return;
  }
  if (shortcut.kind === "approval-no") {
    pendingApproval = null;
    await sendWhatsAppMessage(page, "Cancelled.");
    return;
  }
  if (shortcut.kind === "stop") {
    await sendWhatsAppMessage(page, "Stopping bridge now.");
    process.exit(0);
  }
  if (!shortcut.safe) {
    pendingApproval = {
      original: command,
      prompt: shortcut.prompt,
      createdAt: Date.now(),
    };
    await sendWhatsAppMessage(page, `This looks risky. Reply "${config.commandPrefix} yes" to run it or "${config.commandPrefix} no" to cancel.`);
    return;
  }
  await sendWhatsAppMessage(page, "Received. Running Codex on the laptop...");
  const result = await runBackend(shortcut.prompt, message);
  await sendWhatsAppMessage(page, result.reply, result.rawLogPath);
}

async function main() {
  if (!validateConfig()) return;

  await mkdir(config.profileDir, { recursive: true });
  await mkdir(config.logDir, { recursive: true });
  const seen = await loadSeen();
  info(`Launching browser channel "${config.browserChannel || "default"}" with profile ${config.profileDir}`);
  const context = await chromium.launchPersistentContext(config.profileDir, {
    headless: false,
    ...(config.browserExecutable
      ? { executablePath: config.browserExecutable }
      : config.browserChannel
        ? { channel: config.browserChannel }
        : {}),
    viewport: { width: 1280, height: 900 },
  });
  info("Browser launched.");
  if (smokeBrowserOnly) {
    await context.close();
    info("Smoke browser check passed.");
    return;
  }
  const page = context.pages()[0] ?? await context.newPage();

  await openTargetChat(page);
  const initialMessages = await readMessages(page);
  if (!config.processExisting && seen.size === 0) {
    for (const message of initialMessages) seen.add(message.key);
    await saveSeen(seen);
    info(`Marked ${initialMessages.length} existing messages as seen.`);
  }

  info(`Listening for incoming messages prefixed with "${config.commandPrefix}". Press Ctrl+C to stop.`);

  while (true) {
    try {
      const messages = await readMessages(page);
      debug(`Read ${messages.length} message bubbles.`);
      for (const message of messages) {
        if (seen.has(message.key)) continue;
        seen.add(message.key);
        debug(`New ${message.direction} message: ${JSON.stringify(message.text.slice(0, 120))}`);

        if (!senderAllowed(message)) {
          debug(`Skipped message from non-allowlisted sender metadata: ${message.meta}`);
          continue;
        }
        if (message.direction === "out" && !config.allowOutgoingCommands) {
          debug("Skipped outgoing message. Set allowOutgoingCommands=true for self-chat mode.");
          continue;
        }
        const command = extractCommand(message.text);
        if (command == null) {
          debug(`Skipped message without prefix "${config.commandPrefix}".`);
          continue;
        }
        if (!command) {
          await sendWhatsAppMessage(page, `Send "${config.commandPrefix} <instruction>" to run Codex.`);
          continue;
        }

        await saveSeen(seen);
        try {
          await handleCommand(page, command, message);
        } catch (error) {
          await sendWhatsAppMessage(page, `Bridge error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      await saveSeen(seen);
    } catch (error) {
      console.error("[bridge] poll failed:", error instanceof Error ? error.message : error);
    }
    await page.waitForTimeout(config.pollMs);
  }
}

process.on("SIGINT", () => {
  info("Stopping.");
  process.exit(0);
});

await main();
