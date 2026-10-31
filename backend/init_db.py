import os
import re
import sys
from pathlib import Path
from dotenv import load_dotenv
import pymysql

env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

db_host = os.getenv("DB_HOST", "localhost")
db_port = int(os.getenv("DB_PORT", "3306"))
db_user = os.getenv("DB_USER", "root")
db_password = os.getenv("DB_PASSWORD", "")
db_name = os.getenv("DB_NAME", "pipeline_box")
anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")

def mask_pw(text: str) -> str:
    if not text:
        return text
    if db_password and db_password in text:
        text = text.replace(db_password, "********")
    return re.sub(r"password=['\"][^'\"]*['\"]", "password='********'", text)

print("Checking environment configuration...")
if anthropic_key == "your_anthropic_api_key_here" or not anthropic_key:
    print("WARNING: ANTHROPIC_API_KEY is unset or placeholder. AI features will run in fallback mode.")
else:
    print("ANTHROPIC_API_KEY detected.")

print(f"Connecting to MySQL server at {db_host}:{db_port} as user '{db_user}'...")
try:
    conn = pymysql.connect(
        host=db_host,
        port=db_port,
        user=db_user,
        password=db_password,
        charset="utf8mb4",
        autocommit=True
    )
    with conn.cursor() as cursor:
        cursor.execute(f"CREATE DATABASE IF NOT EXISTS `{db_name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;")
        cursor.execute(f"SHOW DATABASES LIKE '{db_name}';")
        res = cursor.fetchone()
        if res:
            print(f"SUCCESS: Database '{db_name}' exists and is ready.")
        else:
            print(f"ERROR: Could not verify database '{db_name}'.")
            sys.exit(1)
    conn.close()
except Exception as e:
    err_msg = mask_pw(str(e))
    print(f"CONNECTION_FAILED: {err_msg}")
    sys.exit(1)
