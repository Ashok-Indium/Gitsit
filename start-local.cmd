@echo off
rem Starts the Pacific Private Money bid model app locally at http://localhost:5173.
rem Uses the portable Node install for this window only; the system PATH is not changed.
setlocal
set "NODE_HOME=%LOCALAPPDATA%\Programs\node-v24.22.1-win-x64"
if not exist "%NODE_HOME%\node.exe" (
  echo Node.js was not found at %NODE_HOME%
  pause
  exit /b 1
)
set "PATH=%NODE_HOME%;%PATH%"
set "RAYFIN_TELEMETRY_OPTOUT=1"
cd /d "%~dp0"
if not exist node_modules call npm install
start "" cmd /c "timeout /t 8 >nul & start http://localhost:5173"
call npm run dev
pause
