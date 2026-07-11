import os
from urllib.parse import urlparse
import psycopg2
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from fastapi import Request
from dotenv import load_dotenv

load_dotenv()

# ===================================================================
# DATABASE CONNECTION CONFIGURATION (SUPABASE COMPATIBLE)
# ===================================================================
# Reads a single DATABASE_URL from environment (Supabase or local).
# Instead of creating 4 separate databases, we create 4 isolated
# schemas (namespaces) inside this single database:
#   - bank, esevai, post_office, municipal
# ===================================================================

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:nambatha@localhost:5432/postgres")

# Render uses postgres:// but SQLAlchemy/psycopg2 requires postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Ensure all 4 schemas exist in the database on startup
def create_schemas_if_not_exist():
    try:
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = True
        cursor = conn.cursor()
        
        target_schemas = ["bank", "esevai", "post_office", "municipal"]
        for schema in target_schemas:
            cursor.execute(f"CREATE SCHEMA IF NOT EXISTS {schema}")
            print(f"[INFO] Verified/Created schema: {schema}")
            
        cursor.close()
        conn.close()
    except Exception as e:
        print("[DATABASE STARTUP WARNING] Could not verify/create schemas:", e)

# Run schema creation check immediately on import
create_schemas_if_not_exist()

# Office types mapping
OFFICES = ["BANK", "ESEVAI", "POST_OFFICE", "MUNICIPAL"]

# Build SQLAlchemy engines and SessionLocal managers for each office schema
engines = {}
session_factories = {}

for office in OFFICES:
    schema_name = office.lower()
    
    # Configure the engine to default to this specific schema using search_path connection arguments
    # This isolates queries for each counter/center to their respective schema
    engines[office] = create_engine(
        DATABASE_URL,
        connect_args={"options": f"-c search_path={schema_name}"}
    )
    session_factories[office] = sessionmaker(autocommit=False, autoflush=False, bind=engines[office])

Base = declarative_base()

# Helper to open connection to a specific center database schema
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
