@echo off
echo Starting Data Pipeline in a Box (Backend + Frontend)...
start "Pipeline Backend (FastAPI)" cmd /k "python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload"
timeout /t 2 >nul
start "Pipeline Frontend (Vite)" cmd /k "npm run dev"
echo Both servers started!
echo Frontend: http://localhost:8080
echo Backend:  http://localhost:8000
