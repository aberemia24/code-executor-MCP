# Release Process for v0.3.3

## ✅ Pre-Release Checklist (COMPLETED)

- [x] All critical fixes implemented
- [x] All tests passing (219/219)
- [x] Lint, typecheck, build all passing
- [x] CHANGELOG.md updated
- [x] Changes committed to develop branch
- [x] PR created to main branch (#4)
- [x] Release notes prepared

---

## 🚀 Release Steps (TO BE EXECUTED)

### Step 1: Review and Merge PR

```bash
# Review PR online
open https://github.com/aberemia24/code-executor-MCP/pull/4

# OR merge via CLI after review
gh pr review 4 --approve
gh pr merge 4 --merge
```

### Step 2: Update Local Main Branch

```bash
git checkout main
git pull origin main
```

### Step 3: Bump Version to v0.3.3

```bash
# This updates package.json and creates a git tag
npm version patch -m "chore: release v0.3.3

Type Safety & Runtime Safety Improvements"
```

### Step 4: Push Version Commit and Tag

```bash
git push origin main --follow-tags
```

### Step 5: Create GitHub Release

```bash
# Create release with prepared notes
gh release create v0.3.3 \
  --title "v0.3.3 - Type Safety & Runtime Safety Improvements" \
  --notes-file release-notes-v0.3.3.md
```

### Step 6: Sync Develop Branch

```bash
git checkout develop
git merge main
git push origin develop
```

### Step 7: Verify Release

```bash
# Check GitHub release page
open https://github.com/aberemia24/code-executor-MCP/releases/tag/v0.3.3

# Verify version in package.json
cat package.json | grep version
```

---

## 📦 Optional: Publish to npm (If Configured)

```bash
# Make sure you're on main branch with latest changes
git checkout main
git pull origin main

# Publish to npm registry
npm publish

# Verify publication
npm view code-executor-mcp version
```

---

## 🔍 Verification Commands

After release, verify everything is correct:

```bash
# Check latest tag
git tag --sort=-version:refname | head -1

# Check remote tags
git ls-remote --tags origin

# Verify GitHub release exists
gh release list | grep v0.3.3

# Check package.json version
jq -r .version package.json
```

---

## 🎯 Expected Results

After completing all steps:

1. ✅ PR #4 merged to main
2. ✅ package.json version: `0.3.3`
3. ✅ Git tag `v0.3.3` pushed to origin
4. ✅ GitHub release created with detailed notes
5. ✅ Develop branch synced with main
6. ✅ (Optional) Package published to npm

---

## 📋 Troubleshooting

### Issue: Version bump fails

```bash
# Check if working directory is clean
git status

# If untracked files exist, review and add or ignore them
git add .
# OR
echo "filename" >> .gitignore
```

### Issue: Tag already exists

```bash
# Delete local tag
git tag -d v0.3.3

# Delete remote tag
git push origin :refs/tags/v0.3.3

# Try npm version again
npm version patch
```

### Issue: Push rejected

```bash
# Pull latest changes
git pull origin main --rebase

# Push again
git push origin main --follow-tags
```

---

## 🎉 Post-Release

### Announce Release (Optional)

- Update project README if needed
- Notify users/contributors
- Update documentation
- Post on social media/forums if applicable

### Monitor

- Check for issues reported on new version
- Monitor npm download stats (if published)
- Review any CI/CD build failures

---

## 📝 Notes

- **Breaking Changes:** None - This is a quality improvement release
- **Migration Required:** No
- **Deprecations:** None
- **Security Fixes:** Yes (runtime safety improvements)

---

**Date:** 2024-11-10
**Release Type:** Patch (v0.3.2 → v0.3.3)
