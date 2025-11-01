# Git Backup Setup Guide

Your repository has been initialized with Git! Here are your backup options:

## ✅ Completed Setup
- Git repository initialized
- Initial commit created
- Files tracked in version control

## 🔄 Daily Backup Workflow

### Option 1: Manual Backup (Current Setup)
To create a backup, run these commands:

```powershell
git add .
git commit -m "Backup: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
```

### Option 2: Automated Backups with GitHub (Recommended)
This gives you cloud backup and version history accessible from anywhere:

1. Create a repository on GitHub.com
2. Add the remote:
   ```powershell
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   git branch -M main
   git push -u origin main
   ```

3. For future backups:
   ```powershell
   git add .
   git commit -m "Backup: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
   git push
   ```

### Option 3: Automated Scheduled Backups
Create a PowerShell script to run backups automatically:

```powershell
# backup.ps1
cd "c:\Users\me\Documents\Manarion Stuff"
git add .
git commit -m "Auto-backup: $(Get-Date -Format 'yyyy-MM-dd HH:mm')" --allow-empty
```

Then schedule it in Windows Task Scheduler:
1. Open Task Scheduler
2. Create Basic Task
3. Set trigger (e.g., Daily at 2 AM)
4. Action: Start a program
5. Program: PowerShell.exe
6. Arguments: `-File "c:\Users\me\Documents\Manarion Stuff\backup.ps1"`

## 📝 Quick Commands Reference

```powershell
# Check what changed
git status

# Create a backup
git add .
git commit -m "Description of changes"

# Push to cloud (if set up)
git push

# View history
git log

# Restore a previous version
git checkout <commit-hash> -- <file-name>
```

## ⚠️ Important Notes
- Your `.gitignore` already excludes `__pycache__`, `.log`, and `potion_history.json`
- For automated commits, you can add `--allow-empty` flag if no changes
- Consider backing up your database files regularly
