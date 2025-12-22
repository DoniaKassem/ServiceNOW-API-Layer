@echo off
echo Starting ServiceNow AI Orchestration App...
cd /d "%~dp0"

echo Installing dependencies (if needed)...
call npm install

echo Starting development server...
start /B npm run dev

echo Waiting for server to start...
timeout /t 10 /nobreak > nul

echo Opening browser...
start http://localhost:5173

echo Server is running. You can close this window after the browser opens.
echo Press any key to stop the server and close this window.
pause > nul

echo Stopping server...
taskkill /f /im node.exe 2>nul