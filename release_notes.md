### 🚨 CRITICAL BUGFIX #4

**v1.0.4 CLI SETUP & DAILY SYNC BROKEN**

#### Fixed

- **CLI Setup Template Path Resolution** - Fixed "Template not found" error when running globally/via npx
  - **Error:** `Error: Template not found: .../templates/typescript-wrapper.hbs`
  - **Root Cause:** `WrapperGenerator` used `process.cwd()` to locate templates, which fails when running outside the package directory
  - **Fix:** Updated path resolution to use `import.meta.url` relative to the script location
  - **Files:** `src/cli/index.ts`, `src/cli/sync-wrappers-cli.ts`

- **Daily Sync Scheduler Path** - Fixed "scriptPath must be absolute" error
  - **Error:** `Error: scriptPath must be absolute`
  - **Root Cause:** `SystemdScheduler` requires an absolute path to an executable file, but the wizard passed a command string (`npx ...`)
  - **Fix:** Wizard now generates a helper script (`~/.code-executor/daily-sync.sh`) and passes its absolute path to the scheduler
  - **Files:** `src/cli/index.ts`

**⚠️ Critical:** v1.0.4 setup wizard and daily sync are broken for global/npx usage. Upgrade to v1.0.5 recommended.
