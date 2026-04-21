@echo off
echo Installing US Foods Agent dependencies...
pip install httpx playwright
playwright install chromium
echo.
echo Setup complete! Run the agent with:
echo   python usfoods_agent.py --api-url https://sixbeans-api.onrender.com/api --agent-key YOUR_KEY
echo.
echo For dry run (never submits):
echo   python usfoods_agent.py --api-url https://sixbeans-api.onrender.com/api --agent-key YOUR_KEY --dry-run
pause
