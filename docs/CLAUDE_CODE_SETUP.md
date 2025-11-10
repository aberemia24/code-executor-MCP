# Claude Code Setup Guide

This guide explains how to configure Claude Code for this project.

## Automatic Dependency Installation

This project includes a SessionStart hook script that automatically installs dependencies when you start a Claude Code session.

### Configuration

To enable automatic dependency installation, add the following to your `.claude/settings.json` file:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/scripts/install_pkgs.sh"
          }
        ]
      }
    ]
  }
}
```

### What the Hook Does

The `scripts/install_pkgs.sh` script automatically:

1. Installs npm dependencies if `package.json` exists
2. Installs Python dependencies if `requirements.txt` exists
3. Provides informative output during the installation process
4. Exits gracefully with proper error handling

### Manual Installation

If you prefer not to use the hook, you can run the script manually:

```bash
./scripts/install_pkgs.sh
```

### Environment-Specific Configuration

The hook can be configured to run only in specific environments. For example, to run only in remote (web) environments:

```bash
#!/bin/bash

# Only run in remote environments
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

# Rest of the script...
```

### Additional Resources

- [Claude Code Documentation](https://docs.claude.com/en/docs/claude-code)
- [SessionStart Hooks Reference](https://docs.claude.com/en/docs/claude-code/hooks)

## Notes

- The `.claude/` directory is gitignored by default as settings are user-specific
- Each developer should configure their own `.claude/settings.json` file
- The installation script is shared in the repository for consistency
