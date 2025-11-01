# Automatic Git Backup Script
# Run this script to create a backup of your project

$ErrorActionPreference = "Stop"

# Change to project directory
Set-Location "c:\Users\me\Documents\Manarion Stuff"

# Get current date and time
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

Write-Host "Creating backup at $timestamp..." -ForegroundColor Green

# Stage all changes
git add .

# Create commit
git commit -m "Auto-backup: $timestamp"

# Check if we committed anything
if ($LASTEXITCODE -eq 0) {
    Write-Host "Backup created successfully!" -ForegroundColor Green
    
    # Try to push if remote is configured
    git push 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Backup pushed to remote repository!" -ForegroundColor Green
    } else {
        Write-Host "Note: Remote repository not configured or push failed" -ForegroundColor Yellow
    }
} else {
    Write-Host "No changes to commit." -ForegroundColor Yellow
}

Write-Host "Backup process complete!" -ForegroundColor Green
