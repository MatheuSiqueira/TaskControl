@echo off
rem Sobe só o servidor (sem janela do app) num PC que fica ligado. Requer Node.js 22.13 ou superior.
rem Opcional: defina CODIGO_ACESSO para exigir um código dos usuários.
cd /d "%~dp0"
if not exist node_modules call npm install --omit=dev
node server\index.js
pause
