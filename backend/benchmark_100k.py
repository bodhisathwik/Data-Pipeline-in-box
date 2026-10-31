import urllib.request
import json
import time

def benchmark():
    csv_file = "backend/samples/large_100k_sample.csv"
    print(f"Reading {csv_file}...")
    with open(csv_file, "rb") as f:
        data = f.read()

    boundary = "----WebKitFormBoundaryBenchmark100k"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="large_100k_sample.csv"\r\n'
        f"Content-Type: text/csv\r\n\r\n"
    ).encode("utf-8") + data + f"\r\n--{boundary}--\r\n".encode("utf-8")

    req = urllib.request.Request("http://127.0.0.1:8000/upload", data=body)
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")

    print("Uploading 100,000-row dataset to http://127.0.0.1:8000/upload...")
    resp = urllib.request.urlopen(req)
    run_info = json.loads(resp.read().decode())
    run_id = run_info["run_id"]
    print(f"Upload successful. Run ID: {run_id}")

    start_time = time.time()
    while time.time() - start_time < 90:
        res = urllib.request.urlopen(f"http://127.0.0.1:8000/runs/{run_id}")
        run = json.loads(res.read().decode())
        status = run["status"]
        print(f"  [{time.time() - start_time:.1f}s] Pipeline Status: {status}")
        if status in ["completed", "failed"]:
            print("\n==============================================")
            print("100K-ROW BENCHMARK PERFORMANCE RESULTS")
            print("==============================================")
            print(f"Status:             {status}")
            print(f"Rows Ingested:      {run.get('rowsBefore', 0):,}")
            print(f"Rows Retained:      {run.get('rowsAfter', 0):,}")
            print(f"Duplicates Removed: {run.get('duplicatesRemoved', 0):,}")
            print(f"Missing Imputed:    {run.get('missingFixed', 0):,}")
            print(f"Outliers Flagged:   {run.get('outliersCount', 0):,}")
            print(f"PII Columns:        {run.get('piiCount', 0):,}")
            print(f"Quality Score:      {run.get('scoreBefore')} -> {run.get('scoreAfter')} / 100")
            print("----------------------------------------------")
            print(f"Ingest Timing:      {run.get('stageTimings', {}).get('ingest', 0):,} ms")
            print(f"Clean Timing:       {run.get('stageTimings', {}).get('clean', 0):,} ms")
            print(f"Validate Timing:    {run.get('stageTimings', {}).get('validate', 0):,} ms")
            print(f"Score Timing:       {run.get('stageTimings', {}).get('score', 0):,} ms")
            print(f"Store Timing:       {run.get('stageTimings', {}).get('store', 0):,} ms")
            print("----------------------------------------------")
            print(f"Total Duration:     {run.get('durationMs', 0):,} ms ({run.get('durationMs', 0)/1000.0:.2f} s)")
            print(f"Throughput:         {run.get('rowsPerSec', 0):,.0f} rows/second")
            print("==============================================\n")
            if status == "failed":
                print("Error Details:", run.get("errorMessage"))
            return run
        time.sleep(2.0)

if __name__ == "__main__":
    benchmark()

