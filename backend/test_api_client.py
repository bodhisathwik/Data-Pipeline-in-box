import sys
import json
import asyncio
from pathlib import Path
import httpx
import websockets

sample_path = Path(__file__).resolve().parent / "samples" / "messy_customers_sample.csv"

async def test_live_pipeline():
    api_url = "http://localhost:8000"
    ws_url = "ws://localhost:8000"

    print("1. Checking backend /health...")
    async with httpx.AsyncClient() as client:
        try:
            h_res = await client.get(f"{api_url}/health", timeout=5.0)
            print(f"Health response: {h_res.json()}")
        except Exception as e:
            print(f"Failed to reach backend: {e}")
            return

    print("2. Uploading sample CSV to /upload...")
    async with httpx.AsyncClient() as client:
        with open(sample_path, "rb") as f:
            files = {"file": (sample_path.name, f, "text/csv")}
            res = await client.post(f"{api_url}/upload", files=files, timeout=10.0)
            data = res.json()
            run_id = data.get("run_id")
            print(f"Upload response: {data}")

    if not run_id:
        print("Error: No run_id returned.")
        return

    print(f"3. Connecting to WebSocket {ws_url}/ws/runs/{run_id}...")
    try:
        async with websockets.connect(f"{ws_url}/ws/runs/{run_id}") as ws:
            while True:
                msg = await ws.recv()
                event = json.loads(msg)
                stage = event.get("stage")
                progress = event.get("progress_percent")
                message = str(event.get("message", "")).encode("ascii", "replace").decode("ascii")
                print(f"  [Live WS Event] Stage: {stage} ({progress}%) | {message}")
                if progress >= 100 or stage == "Store" or stage == "Failed":
                    print("Pipeline run finished.")
                    break
    except Exception as e:
        print(f"WebSocket client error: {e}")

if __name__ == "__main__":
    asyncio.run(test_live_pipeline())
