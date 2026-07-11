import os
from urllib.parse import urlparse, quote_plus
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from fastapi import Request
from dotenv import load_dotenv

load_dotenv()

# ===================================================================
# DATABASE CONNECTION CONFIGURATION
# ===================================================================
# Reads DATABASE_URL from environment (set automatically by Render,
# or manually in .env for local development).
# Parses the URL to extract host/port/user/password, then builds
# 4 separate database URLs — one per office center.
# ===================================================================

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:nambatha@localhost:5432/postgres")

# Render uses postgres:// but SQLAlchemy requires postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Parse connection components from the URL
parsed = urlparse(DATABASE_URL)
DB_USER = parsed.username or "postgres"
DB_PASS = parsed.password or "nambatha"
DB_HOST = parsed.hostname or "localhost"
DB_PORT = parsed.port or 5432

# Preserve any query params (e.g., ?sslmode=require for Render external connections)
ssl_params = f"?{parsed.query}" if parsed.query else ""

# Base system connection URL (connects to default 'postgres' database for creating new databases)
BASE_PG_URL = f"postgresql://{DB_USER}:{quote_plus(DB_PASS)}@{DB_HOST}:{DB_PORT}/postgres{ssl_params}"

# 4 separate database URLs — one per office center (preserving full data isolation)
DB_MAPPING = {
    "BANK": f"postgresql://{DB_USER}:{quote_plus(DB_PASS)}@{DB_HOST}:{DB_PORT}/smart_token_bank_db{ssl_params}",
    "ESEVAI": f"postgresql://{DB_USER}:{quote_plus(DB_PASS)}@{DB_HOST}:{DB_PORT}/smart_token_esevai_db{ssl_params}",
    "POST_OFFICE": f"postgresql://{DB_USER}:{quote_plus(DB_PASS)}@{DB_HOST}:{DB_PORT}/smart_token_post_office_db{ssl_params}",
    "MUNICIPAL": f"postgresql://{DB_USER}:{quote_plus(DB_PASS)}@{DB_HOST}:{DB_PORT}/smart_token_municipal_db{ssl_params}"
}

# Auto create databases in postgres on startup if they do not exist
def create_dbs_if_not_exist():
    try:
        conn = psycopg2.connect(BASE_PG_URL)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()
        
        target_dbs = [
            "smart_token_bank_db",
            "smart_token_esevai_db",
            "smart_token_post_office_db",
            "smart_token_municipal_db"
        ]
        
        for db_name in target_dbs:
            cursor.execute(f"SELECT 1 FROM pg_catalog.pg_database WHERE datname = '{db_name}'")
            exists = cursor.fetchone()
            if not exists:
                cursor.execute(f"CREATE DATABASE {db_name}")
                print(f"[INFO] Created database: {db_name}")
                
        cursor.close()
        conn.close()
    except Exception as e:
        print("[DATABASE STARTUP WARNING] Could not verify/create databases:", e)

# Run creation check immediately on import
create_dbs_if_not_exist()

# Build SQLAlchemy engines and SessionLocal managers for each center database
engines = {}
session_factories = {}

for office, url in DB_MAPPING.items():
    engines[office] = create_engine(url)
    session_factories[office] = sessionmaker(autocommit=False, autoflush=False, bind=engines[office])

Base = declarative_base()

# Helper to open connection to a specific center database
def get_db_session(office_type: str):
    office = str(office_type).upper().strip()
    if office not in session_factories:
        office = "BANK"
    return session_factories[office]()

# Dynamic dependency resolver for FastAPI routes
async def get_db_dynamic(request: Request):
    # Parse office_type from query parameters
    office_type = request.query_params.get("office_type")
    
    # Fallback to query body if json is parsed
    if not office_type:
        try:
            body = await request.json()
            office_type = body.get("office_type")
        except Exception:
            pass
            
    if not office_type:
        office_type = "BANK"
        
    db = get_db_session(office_type)
    try:
        yield db
    finally:
        db.close()
