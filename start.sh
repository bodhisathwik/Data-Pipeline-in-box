#!/bin/bash
echo "Starting Data Pipeline in a Box (Backend + Frontend)..."
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
npm run dev &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID" SIGINT SIGTERM
wait
