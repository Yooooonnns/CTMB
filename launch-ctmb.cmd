@echo off
cd /d "%~dp0ctmb-display"
set YAZAKI_NODE_SERVER_URL=https://ctmb.onrender.com
npx electron .
