import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
import urllib.parse

env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = os.getenv("DB_PORT", "3306")
DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_NAME = os.getenv("DB_NAME", "pipeline_box")

READONLY_USER = "pipeline_readonly"
READONLY_PASS = "ReadOnlyPass_2026!"

def setup_readonly_user():
    encoded_pass = urllib.parse.quote_plus(DB_PASSWORD)
    admin_url = f"mysql+pymysql://{DB_USER}:{encoded_pass}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    admin_engine = create_engine(admin_url)

    print(f"Connecting to MySQL as {DB_USER} to provision {READONLY_USER}...")
    with admin_engine.connect() as conn:
        conn.execute(text(f"CREATE USER IF NOT EXISTS '{READONLY_USER}'@'%' IDENTIFIED BY '{READONLY_PASS}';"))
        conn.execute(text(f"GRANT SELECT ON `{DB_NAME}`.* TO '{READONLY_USER}'@'%';"))
        conn.execute(text("FLUSH PRIVILEGES;"))
        conn.commit()
    print(f"User '{READONLY_USER}' provisioned with SELECT-only grants on `{DB_NAME}`.*.")

    # Test read-only permissions
    ro_encoded = urllib.parse.quote_plus(READONLY_PASS)
    ro_url = f"mysql+pymysql://{READONLY_USER}:{ro_encoded}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    ro_engine = create_engine(ro_url)

    print("Testing read permission...")
    with ro_engine.connect() as conn:
        res = conn.execute(text("SELECT 1;")).scalar()
        print(f"Read test passed: SELECT 1 returned {res}")

    print("Testing write denial (expecting permission denied)...")
    try:
        with ro_engine.connect() as conn:
            conn.execute(text("CREATE TABLE __test_ro_fail (id INT);"))
            conn.commit()
        print("ERROR: Write succeeded when it should have failed!")
        return False
    except Exception as e:
        print("Success! Write attempt correctly denied:")
        print(f"  {e}")
        return True

if __name__ == "__main__":
    setup_readonly_user()

