# Ray-Ban WhatsApp Codex Bridge

Private wearable-to-Codex automation bridge using Ray-Ban Meta voice messages, WhatsApp Web, and Codex CLI.

## Project Overview

This project lets a Ray-Ban Meta user send short WhatsApp voice/text commands to a laptop and receive Codex replies back in WhatsApp. The bridge is designed for private personal use, course review, and experimentation with safe wearable-to-developer-tool workflows.

```text
Ray-Ban Meta glasses
-> WhatsApp message
-> WhatsApp Web on laptop
-> local Node.js bridge
-> Codex CLI
-> short WhatsApp reply
```

The bridge opens WhatsApp Web in a persistent Chrome profile, watches one configured chat, ignores normal messages, and only runs commands that start with the configured prefix such as `ai`.

## Features

- WhatsApp Web bridge controlled by Ray-Ban Meta voice messages.
- Prefix-based command handling with default prefix `ai`.
- Shortcuts for `ai hi`, `ai status`, `ai summary`, `ai test`, `ai continue`, and `ai stop`.
- Free-form Codex prompts such as `ai explain this repo`.
- Short voice-friendly replies in WhatsApp.
- Full raw command output saved in local logs.
- Approval flow for risky commands using `ai yes` and `ai no`.
- Helper scripts for start, stop, and status checks.

## Setup

Install Node.js 20 or newer, Google Chrome, and Codex CLI on the laptop.

Install project dependencies:

```powershell
npm install
```

Create local config:

```powershell
Copy-Item config.example.json config.local.json
```

Edit `config.local.json`:

- Set `chatPhone` to the WhatsApp chat phone number to watch.
- Keep `commandPrefix` as `ai` or choose your own prefix.
- Set `runner` and `runnerArgs` for your local Codex CLI if the default `codex exec` command does not work.

Start the bridge:

```powershell
npm run start
```

On first launch, WhatsApp Web may ask for a QR scan. After login, send a command from the configured chat:

```text
ai hi
```

Check status:

```powershell
npm run status
```

Stop the bridge:

```powershell
npm run stop
```

## WhatsApp Commands

```text
ai hi
ai status
ai summary
ai test
ai continue
ai stop
```

Free-form examples:

```text
ai explain this project
ai check the latest error
ai make a short plan for the next fix
```

Risky commands ask for approval before running:

```text
ai delete old logs
```

Approve or cancel:

```text
ai yes
ai no
```

## Safety Notes

- Do not commit `config.local.json`.
- Do not commit WhatsApp Web profile/session data.
- Do not commit logs containing private messages.
- Keep the bridge private to your own WhatsApp chat.
- Do not use this for bulk messaging or spam.
- WhatsApp Web UI changes may require selector updates.

## Future Roadmap

- Shared memory file for long-term bridge context.
- Task inbox for saving voice tasks from glasses.
- Command history and `ai last` / `ai repeat`.
- Image or screenshot analysis through WhatsApp media messages.
- Project switching for multiple local repositories.
- Safer approval codes for destructive laptop actions.
- Optional Android controller app as a cleaner frontend than WhatsApp.

## Course Summary

This project demonstrates how wearable device input, WhatsApp Web automation, local scripts, Codex CLI, safety checks, and short-form conversational responses can work together as a private developer assistant. It is a practical prototype for controlling a coding environment remotely from smart glasses.
