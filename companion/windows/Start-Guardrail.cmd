@echo off
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "%~dp0Register-Guardrail.ps1"
if errorlevel 1 (
  echo Guardrail app-link setup failed. Please check the message above.
  pause
  exit /b 1
)
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "%~dp0Start-Guardrail.ps1"
