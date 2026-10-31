# Data Pipeline in a Box (AMOLED Production Edition)

An enterprise-ready, automated end-to-end data ingestion, vectorized cleaning, 4D quality scoring, PII redaction, and AI remediation platform featuring a true AMOLED black UI (#000000) and a high-throughput MySQL backend.

---

## Architecture Diagram

```mermaid
graph TD
    Client[React 19 + TypeScript + Tailwind<br/>AMOLED Black Theme #000000]
    Upload[Drag & Drop / POST /upload] -->|CSV, TSV, XLSX, Parquet| FastAPI[FastAPI Backend :8000]
    FastAPI -->|Async Background Task| Engine[Vectorized Pipeline Engine]

    subgraph Pipeline Lifecycle
        S1[1. Ingest<br/>Auto-delimiter & C-engine] --> S2[2. Clean<br/>Vectorized Dedupe & Null Impute]
        S2 --> S3[3. Validate & Audit<br/>IQR Outliers + PII Scan]
        S3 --> S4[4. Score<br/>4D Radar Dimensions]
        S4 --> S5[5. Store & Index<br/>MySQL clean_run_id + cell_changes]
    end

    Engine --> S1
    Engine -->|Throttled 10/s WebSockets| WS_Run[WebSocket /ws/runs/id]
    Engine -->|Aggregate Broadcasts| WS_Dash[WebSocket /ws/dashboard]
    WS_Run -->|Timings, Rows/sec, Live Logs| Client
    WS_Dash -->|Live System Counters| Client

    FastAPI -->|Connection Pool| MySQL[(MySQL 8.0 Database<br/>pipeline_box)]
    Client -->|Cell Lineage & Revert| LineageAPI[GET /lineage & POST /revert]
    Client -->|Whitelisted AI Fixes| FixAPI[POST /fixes/id/approve]
    Client -->|Export as Code| CodeAPI[GET /export/pipeline?format=python|sql]
    Client -->|Safe NL-to-SQL| AI[Claude AI Analyst + Injection Filter]
    AI -->|SELECT only with LIMIT| MySQL
```

---

## 4-Dimension Quality Radar

Data quality is scored across 4 weighted dimensions before and after cleaning, visualized with an interactive Recharts `RadarChart`:

| Dimension | Weight | Definition & Formula |
| :--- | :---: | :--- |
| **Completeness** | **30%** | Ratio of non-null and non-blank cells across all columns. |
| **Uniqueness** | **25%** | $1.0 - (\text{duplicate rows} / \text{total rows})$. Exact duplicate rows removed. |
| **Validity** | **25%** | $1.0 - (\text{type errors + schema violations} / \text{total cells})$. Type coercion and validation rules. |
| **Consistency** | **20%** | Share of values matching dominant casing, date formatting, and phone/ID syntax patterns. |

**Overall Score Formula:**
$$\text{Quality Score} = 0.30 \times \text{Completeness} + 0.25 \times \text{Uniqueness} + 0.25 \times \text{Validity} + 0.20 \times \text{Consistency}$$

---

## 100,000-Row Scale & Throughput Benchmark

Tested on a realistic 100,000-row messy dataset generated with `backend/samples/generate_large_sample.py` (7.84 MB, 5,000 duplicates, 83,619 nulls, mixed date formats, phone variations, 219 outliers, 2 PII columns):

| Stage | Timing (ms) | Operations Performed |
| :--- | :---: | :--- |
| **1. Ingest** | **578 ms** | Auto-detected CSV schema and ingested 100,000 rows into memory. |
| **2. Clean** | **5,970 ms** | Vectorized deduplication (dropped 5,000 dupes), trimmed whitespace, imputed 83,619 nulls. |
| **3. Validate** | **769 ms** | Inferred schema, evaluated validation rules, vectorized IQR outlier detection, scanned PII. |
| **4. Score** | **772 ms** | Evaluated 4 dimensions before ($80.5\%$) and after ($100.0\%$). |
| **5. Store & Index** | **16,265 ms** | Bulk multi-row insertion (`chunksize=5000`) of 95,000 rows into MySQL and indexed cell diffs. |
| **Total Pipeline** | **25,065 ms** | **25.07 seconds total execution time** |
| **Throughput** | **3,990 rows/sec** | **Real-time vectorized throughput** |

---

## 60-Second Demo Script for Hackathon Judges

### [0:00 - 0:10] The Problem & The Solution
> *"Hi everyone! Data teams spend 80% of their time cleaning dirty CSVs and writing repetitive ETL code. Welcome to **Data Pipeline in a Box**—an automated platform that ingests raw files, vector-cleans them, calculates a 4-dimensional quality score, redacts PII, and exports runnable pipeline code in seconds."*

### [0:10 - 0:25] Real-Time Processing & 100K Throughput
> *"Let's upload a messy dataset. Notice the true AMOLED black UI. As the pipeline runs, our WebSocket tracker streams live progress, stage duration timings, and real-time throughput—benchmarked at nearly **4,000 rows per second** on 100,000 records."*

### [0:25 - 0:35] Quality Radar & Lineage Revert
> *"On the dashboard, check out the **4D Quality Radar**: Completeness, Uniqueness, Validity, and Consistency overlaid Before vs. After. In our data table, notice amber outlier badges with exact IQR bounds. If our automated cleaner changed something you want back, simply click the cell to view its complete audit history and hit **'Revert this fix'**—the original value is restored instantly and the score updates live."*

### [0:35 - 0:48] PII Protection & Whitelisted AI Fixes
> *"Our scanner flagged sensitive PII columns. With one click, **'Mask PII on export'** sanitizes emails and phone numbers. Below, Claude AI proposed actionable fixes like capping revenue outliers and standardizing casing—executed strictly through whitelisted, safe database actions."*

### [0:48 - 1:00] Pipeline as Code & Natural Language Chat
> *"Finally, don't stay locked into our UI: click **'Python Script'** or **'SQL Script'** to download standalone production code that reproduces the entire cleaning pipeline. And ask our AI analyst anything in plain English with built-in prompt injection defense. Thank you!"*

---

## Quick Start

### 1. Requirements
- Node.js 20+
- Python 3.11+
- MySQL Server 8.0+

### 2. Configure Backend Secrets
Create `backend/.env` (modeled after `backend/.env.example`):
```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_actual_password
DB_NAME=pipeline_box
ANTHROPIC_API_KEY=your_key_here
```

### 3. Initialize Database & Run Safe Migrations
```bash
python backend/init_db.py
python backend/migrate.py
```

### 4. Provision Read-Only MySQL User (Security)
```bash
python backend/scripts/create_readonly_user.py
```

### 5. Start Servers
Run the single launcher command:
```bash
start.bat
```
Or start individually:
```bash
# Terminal 1: Backend
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000

# Terminal 2: Frontend
npm run dev
```

- **Frontend:** http://localhost:8080
- **Backend API Docs:** http://localhost:8000/docs

---

## Running Test Suites

Run the end-to-end verification suite:
```bash
python backend/verify_all.py
```

Run pytest unit and security tests:
```bash
python -m pytest backend/tests/test_pipeline.py -v
```

Run the 100,000-row benchmark:
```bash
python backend/samples/generate_large_sample.py
python backend/benchmark_100k.py
```
