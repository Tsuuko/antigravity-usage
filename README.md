<div align="center">
    <img src="https://raw.githubusercontent.com/skainguyen1412/antigravity-usage/main/images/icon.png" alt="antigravity-usage logo" width="150" height="150">
    <h1>antigravity-usage</h1>
</div>

<p align="center">
    <a href="https://npmjs.com/package/antigravity-usage"><img src="https://img.shields.io/npm/v/antigravity-usage?color=yellow" alt="npm version" /></a>
    <a href="https://packagephobia.com/result?p=antigravity-usage"><img src="https://packagephobia.com/badge?p=antigravity-usage" alt="install size" /></a>
    <a href="https://www.npmjs.com/package/antigravity-usage"><img src="https://img.shields.io/npm/dt/antigravity-usage" alt="NPM Downloads" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
    <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node.js Version" /></a>
</p>

<p align="center">
A fast, lightweight, and powerful CLI tool to track your Antigravity model quota and usage. Works offline with your IDE or online with multiple Google accounts.
</p>

<p align="center">
<em>Inspired by <a href="https://github.com/ryoppippi/ccusage">ccusage</a></em>
</p>

<div align="center">
    <img src="https://raw.githubusercontent.com/skainguyen1412/antigravity-usage/main/images/banner.png" alt="Antigravity Usage Screenshot">
</div>


## Quick Start (No Login Required) 🚀

If you have Antigravity running in your IDE (VSCode, JetBrains, etc.), you can check your quota immediately **without logging in**.

```bash
# Install globally
npm install -g antigravity-usage

# Check quota immediately (uses your IDE's connection)
antigravity-usage
```

That's it! The tool automatically connects to your local Antigravity server to fetch the exact same data your IDE sees.

---

## Power User Guide ⚡️

Want to check quota for **multiple accounts** or when your IDE is closed?

### 1. Login with Google
```bash
antigravity-usage login
```

### 1a. Manual Login (Headless/SSH)
If you are on a headless server or cannot open a browser locally:
```bash
antigravity-usage login --manual
```
Follow the on-screen instructions to paste the authentication URL into your local browser and copy the result back.

### 2. Add more accounts
```bash
antigravity-usage accounts add
```

### 3. Check everything at once
```bash
antigravity-usage quota --all
```

---

## How It Works 🛠️

Antigravity Usage employs a smart "Dual-Fetch" strategy to ensure you always get data:

1.  **Local Mode (Priority)**: First, it tries to connect to the Antigravity Language Server running inside your IDE.
    *   **Pros**: Fast, works offline, no extra login required.
    *   **Cons**: IDE must be open.
2.  **Cloud Mode (Fallback)**: If Local Mode fails (or if managing multiple accounts), it uses the Google Cloud Code API.
    *   **Pros**: Works anywhere, supports multiple accounts.
    *   **Cons**: Requires one-time login.

By default, `antigravity-usage` runs in **Auto Mode**, seamlessly switching between these methods.

---

## Features

### 🤖 Auto Wakeup (macOS & Linux)
Never waste quota again. Automatically wake up your AI models to maximize your daily limits.
- **Fully Automatic**: Runs in the background via native system scheduler - no need to keep terminal or Antigravity open
- **Native Cron Integration**: Schedule-based triggers (every N hours, daily, or custom cron)
- **Smart Quota-Reset Detection**: Compares cached snapshots to detect quota resets and trigger only when needed
- **Selected Models Only**: Triggers only your configured models — no unnecessary API calls
- **Multi-Account Support**: Trigger all your accounts simultaneously
- **Built-in Safety**: Deduplication via `cache.json`, detailed history tracking
- **Platform Support**: Currently available on **macOS and Linux** (Windows support coming soon)

See the [Wakeup Command](#antigravity-usage-wakeup-) section for full details.

### 🔐 Multi-Account Management
Manage multiple Google accounts and compare quota across Personal, Work, and other accounts.
- **Check All Accounts**: Use `--all` flag to fetch and compare quota across all logged-in accounts simultaneously
- **Side-by-Side Comparison**: View quota usage and reset times for all accounts in a single table
- **Easy Switching**: Switch between accounts to use different credentials for API calls
- **Privacy Focused**: All tokens stored locally on your machine, never sent to third-party servers

### 🔌 Offline Capabilities
Designed for plane rides and spotty wifi.
- **Direct IDE Access**: Reads directly from the local server loopback.
- **Smart Fallbacks**: If the internet cuts out, it defaults to the last known state from your local IDE.

### ⚡️ Smart Caching
To keep the CLI snappy and avoid hitting API rate limits:
- Quota data is cached for **5 minutes**.
- Use the `--refresh` flag to force a new fetch:
    ```bash
    antigravity-usage quota --refresh
    ```


### 🎯 Focused Model View
By default, `antigravity-usage` hides "autocomplete" models (like `gemini-2.5-flash-002`) to reduce clutter, as these typically share quota with their main counterparts or are less relevant for tracking.

To see **ALL** available models, including autocomplete ones:
```bash
antigravity-usage quota --all-models
```

---

## Command Reference

### `antigravity-usage` (Default)
Alias for `quota`. Fetches and displays usage data.

```bash
antigravity-usage                   # Auto-detect (Local -> Cloud)
antigravity-usage --all             # Fetch ALL accounts
antigravity-usage --method local    # Force local IDE connection
antigravity-usage --method google   # Force google IDE connection
antigravity-usage --all-models      # Show ALL models (including autocomplete)
antigravity-usage --json            # Output JSON for scripts
antigravity-usage --version         # Show version number
```

### `antigravity-usage --version`
Display the current version of the CLI tool.

```bash
antigravity-usage --version  # or -V
```

### `antigravity-usage accounts`
Manage your roster of Google accounts.

```bash
antigravity-usage accounts list            # Show all accounts & status
antigravity-usage accounts add             # Login a new account
antigravity-usage accounts switch <email>  # Set active account
antigravity-usage accounts remove <email>  # Logout & delete data
```

### `antigravity-usage doctor`
Troubleshoot issues with your setup. Checks env vars, auth status, and local server connectivity.

### `antigravity-usage status`
Quickly check if your auth tokens are valid or expired.

### `antigravity-usage wakeup` 🚀
**Never waste quota again.** Automatically wake up your AI models when quota resets to maximize your daily limits.

> **Platform Support:** Currently available on **macOS** and **Linux**. Windows support (via Task Scheduler) is coming soon.

```bash
antigravity-usage wakeup config     # Interactive setup (takes 30 seconds)
antigravity-usage wakeup trigger    # Run trigger (cron calls this)
antigravity-usage wakeup install    # Install to native system cron
antigravity-usage wakeup status     # Check configuration & next run
antigravity-usage wakeup test       # Test trigger manually
antigravity-usage wakeup history    # View trigger history
```

**Why This Matters:**
Your Antigravity quota resets periodically, but if you don't use it, you lose it. The wakeup feature ensures you **automatically trigger** models to keep your quota flowing.

#### 🎯 Intelligent Model Selection
Zero configuration needed. Default models cover all quota groups:
- **`claude-sonnet-4-6`** → Triggers the entire Claude family
- **`gemini-3-flash`** → Triggers Gemini flash quota group
- **`gemini-3.1-pro-low`** → Triggers Gemini pro quota group

Only configured models are triggered — no unnecessary API calls.

#### ⚡️ Two Powerful Trigger Modes

**1. Smart Quota-Reset Detection** (Recommended)
The most intelligent trigger mode. Compares the current quota snapshot against the previous cached snapshot (`cache.json`) to detect when:
- Model quota is at **100%** (unused)
- `resetTime` has **changed** since last check (quota cycle has reset)

When detected, it triggers only the selected models via the Google Cloud Code API. Run it periodically via cron to catch every reset.

```bash
antigravity-usage wakeup config
# Select: "Quota-reset-based" mode

antigravity-usage wakeup install
# ✅ Installs cron job that runs `wakeup trigger` every 1 hour
```

**2. Schedule-Based** (Native Cron Integration)
Runs locally on your machine with zero dependencies:
- **Interval Mode**: Every N hours (e.g., every 6 hours)
- **Daily Mode**: At specific times (e.g., 9 AM, 5 PM)
- **Custom Mode**: Advanced cron expressions for power users

```bash
antigravity-usage wakeup install
# ✅ Installs to your system's native crontab (macOS/Linux)
# ✅ Runs even when terminal/Antigravity is closed
# ✅ Persists across reboots
```

#### 🛡️ Built-in Safety Features
- **Deduplication**: Uses `cache.json` to prevent re-triggering the same reset cycle
- **Multi-Account Support**: Triggers for all valid accounts simultaneously
- **Detailed History**: Track every trigger with timestamps and results (up to 100 entries)
- **Token Efficiency**: Minimal output tokens (just 1 token per request)

#### 📊 Real-Time Monitoring
```bash
antigravity-usage wakeup status
```
Shows:
- ✅ Enabled/disabled status
- 📅 Next scheduled run time
- 🎯 Selected models and accounts
- 📝 Last trigger result
- ⚙️ Cron installation status

## Configuration
Data is stored in your system's standard config location:
- **macOS**: `~/Library/Application Support/antigravity-usage/`
- **Linux**: `~/.config/antigravity-usage/`
- **Windows**: `%APPDATA%/antigravity-usage/`

## Development
```bash
npm run dev -- quota --all
npm test
```

## License
MIT
