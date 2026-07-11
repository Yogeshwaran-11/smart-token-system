import datetime
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from . import models, schemas

def get_start_of_day():
    now = datetime.datetime.utcnow()
    return datetime.datetime(now.year, now.month, now.day, 0, 0, 0)

def generate_token_number(db: Session, service_code: str, office_type: str) -> str:
    start_of_day = get_start_of_day()
    
    # Count tokens created today for this specific service code and office
    count = db.query(func.count(models.Token.id)).filter(
        models.Token.service_code == service_code,
        models.Token.office_type == office_type,
        models.Token.created_at >= start_of_day
    ).scalar()
    
    next_num = (count or 0) + 1
    return f"{service_code}-{next_num:02d}"

def get_optimal_counter(db: Session, office_type: str, service_code: str) -> Optional[int]:
    from .ml_model import get_agent_speed_for_service
    # Get active counters for this office
    counters = db.query(models.Counter).filter(
        models.Counter.office_type == office_type,
        models.Counter.is_active == True
    ).all()
    
    if not counters:
        return None
        
    start_of_day = get_start_of_day()
    best_counter = None
    min_workload = float('inf')
    
    for counter in counters:
        agent_email = counter.current_agent_email
        speed = get_agent_speed_for_service(db, agent_email, service_code)
        
        # Calculate pending count assigned to this counter
        pending_count = db.query(func.count(models.Token.id)).filter(
            models.Token.status == "PENDING",
            models.Token.office_type == office_type,
            models.Token.counter_assigned == counter.counter_number,
            models.Token.created_at >= start_of_day
        ).scalar() or 0
        
        # Calculate estimated remaining time of currently serving token
        active_token = db.query(models.Token).filter(
            models.Token.status == "SERVING",
            models.Token.office_type == office_type,
            models.Token.counter_assigned == counter.counter_number,
            models.Token.created_at >= start_of_day
        ).first()
        
        remaining_time = 0.0
        if active_token and active_token.served_at:
            elapsed = (datetime.datetime.utcnow() - active_token.served_at).total_seconds() / 60.0
            remaining_time = max(0.0, speed - elapsed)
            
        # Expected workload = remaining + pending * speed + speed (for the new token)
        workload = remaining_time + (pending_count * speed) + speed
        
        if workload < min_workload:
            min_workload = workload
            best_counter = counter.counter_number
            
    # Fallback to first active counter if best_counter is None
    if best_counter is None and counters:
        best_counter = counters[0].counter_number
        
    return best_counter

def create_token(db: Session, token_in: schemas.TokenCreate, office_type: str) -> models.Token:
    from .ml_model import predict_wait_time
    token_number = generate_token_number(db, token_in.service_code, office_type)
    
    start_of_day = get_start_of_day()
    
    # Count current pending tokens in this office
    pending_count = db.query(func.count(models.Token.id)).filter(
        models.Token.status == "PENDING",
        models.Token.office_type == office_type,
        models.Token.created_at >= start_of_day
    ).scalar() or 0
    
    # Count active counters
    active_counters = db.query(func.count(models.Counter.id)).filter(
        models.Counter.office_type == office_type,
        models.Counter.is_active == True
    ).scalar() or 1
    
    # Smart Dispatch Routing Heuristic: pre-assign optimal counter
    optimal_counter = get_optimal_counter(db, office_type, token_in.service_code)
    
    # AI-Powered wait time prediction (ML)
    est_wait = predict_wait_time(
        db=db,
        office_type=office_type,
        service_code=token_in.service_code,
        queue_length=pending_count,
        active_counters=active_counters,
        assigned_counter_number=optimal_counter
    )
    
    db_token = models.Token(
        token_number=token_number,
        service_code=token_in.service_code,
        service_name=token_in.service_name,
        customer_info=token_in.customer_info,
        office_type=office_type,
        status="PENDING",
        counter_assigned=optimal_counter, # Pre-assigned optimal counter
        queue_length_at_creation=pending_count,
        active_counters_at_creation=active_counters if active_counters > 0 else 1,
        estimated_wait_minutes=est_wait
    )
    
    db.add(db_token)
    db.commit()
    db.refresh(db_token)
    return db_token

def get_token(db: Session, token_id: int) -> Optional[models.Token]:
    return db.query(models.Token).filter(models.Token.id == token_id).first()

def get_pending_tokens(db: Session, office_type: str) -> List[models.Token]:
    start_of_day = get_start_of_day()
    return db.query(models.Token).filter(
        models.Token.status == "PENDING",
        models.Token.office_type == office_type,
        models.Token.created_at >= start_of_day
    ).order_by(models.Token.created_at.asc()).all()

def call_next_token(db: Session, counter_number: int, office_type: str, agent_email: str = None, service_codes: List[str] = None) -> Optional[models.Token]:
    start_of_day = get_start_of_day()
    
    # Auto-complete any active tokens on this counter for this office
    active_current = db.query(models.Token).filter(
        models.Token.counter_assigned == counter_number,
        models.Token.status == "SERVING",
        models.Token.office_type == office_type,
        models.Token.created_at >= start_of_day
    ).first()
    if active_current:
        active_current.status = "COMPLETED"
        active_current.completed_at = datetime.datetime.utcnow()
    
    # Prioritize pending tokens pre-assigned to this counter
    query_assigned = db.query(models.Token).filter(
        models.Token.status == "PENDING",
        models.Token.office_type == office_type,
        models.Token.counter_assigned == counter_number,
        models.Token.created_at >= start_of_day
    )
    if service_codes:
        query_assigned = query_assigned.filter(models.Token.service_code.in_(service_codes))
        
    next_token = query_assigned.order_by(models.Token.created_at.asc()).first()
    
    # Fallback to oldest pending token unassigned (or any pending token)
    if not next_token:
        query_unassigned = db.query(models.Token).filter(
            models.Token.status == "PENDING",
            models.Token.office_type == office_type,
            models.Token.created_at >= start_of_day
        )
        if service_codes:
            query_unassigned = query_unassigned.filter(models.Token.service_code.in_(service_codes))
            
        next_token = query_unassigned.order_by(models.Token.created_at.asc()).first()
    
    if next_token:
        next_token.status = "SERVING"
        next_token.counter_assigned = counter_number
        next_token.served_at = datetime.datetime.utcnow()
        if agent_email:
            next_token.agent_email = agent_email
        
        # Link to counter in db
        counter = db.query(models.Counter).filter(
            models.Counter.counter_number == counter_number,
            models.Counter.office_type == office_type
        ).first()
        if counter:
            counter.current_token_id = next_token.id
            if agent_email:
                counter.current_agent_email = agent_email
            
        db.commit()
        db.refresh(next_token)
        
    return next_token

def update_token_status(db: Session, token_id: int, status: str) -> Optional[models.Token]:
    db_token = get_token(db, token_id)
    if db_token:
        db_token.status = status
        if status in ["COMPLETED", "MISSED"]:
            db_token.completed_at = datetime.datetime.utcnow()
            # Also clear the counter association if active
            counter = db.query(models.Counter).filter(
                models.Counter.current_token_id == token_id
            ).first()
            if counter:
                counter.current_token_id = None
        db.commit()
        db.refresh(db_token)
    return db_token

def get_active_tokens(db: Session, office_type: str) -> List[models.Token]:
    start_of_day = get_start_of_day()
    return db.query(models.Token).filter(
        models.Token.status == "SERVING",
        models.Token.office_type == office_type,
        models.Token.created_at >= start_of_day
    ).all()

def get_admin_metrics(db: Session, office_type: str):
    start_of_day = get_start_of_day()
    
    total = db.query(func.count(models.Token.id)).filter(models.Token.office_type == office_type, models.Token.created_at >= start_of_day).scalar() or 0
    completed = db.query(func.count(models.Token.id)).filter(models.Token.status == "COMPLETED", models.Token.office_type == office_type, models.Token.created_at >= start_of_day).scalar() or 0
    missed = db.query(func.count(models.Token.id)).filter(models.Token.status == "MISSED", models.Token.office_type == office_type, models.Token.created_at >= start_of_day).scalar() or 0
    serving = db.query(func.count(models.Token.id)).filter(models.Token.status == "SERVING", models.Token.office_type == office_type, models.Token.created_at >= start_of_day).scalar() or 0
    pending = db.query(func.count(models.Token.id)).filter(models.Token.status == "PENDING", models.Token.office_type == office_type, models.Token.created_at >= start_of_day).scalar() or 0
    
    completed_tokens = db.query(models.Token).filter(
        models.Token.status == "COMPLETED",
        models.Token.office_type == office_type,
        models.Token.created_at >= start_of_day,
        models.Token.served_at.isnot(None)
    ).all()
    
    avg_wait_sec = 0
    if completed_tokens:
        total_wait = sum((t.served_at - t.created_at).total_seconds() for t in completed_tokens)
        avg_wait_sec = total_wait / len(completed_tokens)
        
    return {
        "total_tokens": total,
        "completed_count": completed,
        "missed_count": missed,
        "serving_count": serving,
        "pending_count": pending,
        "avg_wait_minutes": round(avg_wait_sec / 60, 1)
    }

def get_counters(db: Session, office_type: str) -> List[models.Counter]:
    counters = db.query(models.Counter).filter(models.Counter.office_type == office_type).order_by(models.Counter.counter_number.asc()).all()
    # Seed default counters (1, 2, 3) for this center if none exist
    if not counters:
        for num in [1, 2, 3]:
            new_c = models.Counter(counter_number=num, is_active=True, office_type=office_type)
            db.add(new_c)
        db.commit()
        counters = db.query(models.Counter).filter(models.Counter.office_type == office_type).order_by(models.Counter.counter_number.asc()).all()
    return counters

def create_counter(db: Session, counter_number: int, office_type: str) -> models.Counter:
    # Check if exists in this office
    existing = db.query(models.Counter).filter(
        models.Counter.counter_number == counter_number,
        models.Counter.office_type == office_type
    ).first()
    if existing:
        return existing
        
    db_counter = models.Counter(counter_number=counter_number, is_active=True, office_type=office_type)
    db.add(db_counter)
    db.commit()
    db.refresh(db_counter)
    return db_counter

def update_counter_status(db: Session, counter_id: int, is_active: bool) -> Optional[models.Counter]:
    counter = db.query(models.Counter).filter(models.Counter.id == counter_id).first()
    if counter:
        counter.is_active = is_active
        db.commit()
        db.refresh(counter)
    return counter

def get_user_by_email(db: Session, email: str) -> Optional[models.User]:
    return db.query(models.User).filter(models.User.email == email).first()

def create_user(db: Session, user_in: schemas.UserCreate, role: str = "customer") -> models.User:
    from .database import get_db_session
    
    # Create the user in the primary center database
    db_user = models.User(
        email=user_in.email,
        password=user_in.password,
        role=role,
        office_type=user_in.office_type
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    
    # If customer, replicate account credentials to the other 3 databases for unified login
    if role == "customer":
        offices = ["BANK", "ESEVAI", "POST_OFFICE", "MUNICIPAL"]
        for office in offices:
            if office != user_in.office_type:
                other_db = get_db_session(office)
                try:
                    existing = other_db.query(models.User).filter(models.User.email == user_in.email).first()
                    if not existing:
                        new_user = models.User(
                            email=user_in.email,
                            password=user_in.password,
                            role=role,
                            office_type=office
                        )
                        other_db.add(new_user)
                        other_db.commit()
                except Exception as e:
                    other_db.rollback()
                    print(f"[REPLICATION WARNING] Failed to seed user to {office}:", e)
                finally:
                    other_db.close()
                    
    return db_user

def authenticate_user(db: Session, login_in: schemas.UserLogin) -> Optional[models.User]:
    user = get_user_by_email(db, login_in.email)
    # Match password
    if user and user.password == login_in.password:
        # Customers can log into any center
        if user.role == "customer":
            return user
        # For staff and TV, verify the office type matches
        if user.office_type == login_in.office_type or user.office_type == "ALL":
            return user
    return None

def seed_users(db: Session, office_type: str):
    passwords = {
        "BANK": {"admin": "AdminOfBank", "agent": "AgentOfBank", "tv": "TelevisionOfBank"},
        "ESEVAI": {"admin": "AdminOfesevai01", "agent": "AgentOfEsevai", "tv": "TelevisionOfEsevai"},
        "POST_OFFICE": {"admin": "AdminOfPostOffice", "agent": "AgentOfPostOffice", "tv": "TelevisionOfPostOffice"},
        "MUNICIPAL": {"admin": "AdminOfMunicipal", "agent": "AgentOfMunicipal", "tv": "TelevisionOfMunicipal"}
    }
    
    if office_type not in passwords:
        return
        
    office_clean = office_type.replace("_", "")
    if office_type == "POST_OFFICE":
        office_clean = "PostOffice"
    elif office_type == "ESEVAI":
        office_clean = "Esevai"
    elif office_type == "MUNICIPAL":
        office_clean = "Municipal"
    elif office_type == "BANK":
        office_clean = "Bank"
        
    admin_email = f"AdminOf{office_clean}@gmail.com"
    agent_email = f"AgentOf{office_clean}@gmail.com"
    tv_email = f"TelevisionOf{office_clean}@gmail.com"
    
    # Check and seed Admin
    if not db.query(models.User).filter(models.User.email == admin_email).first():
        db.add(models.User(email=admin_email, password=passwords[office_type]["admin"], role="admin", office_type=office_type))
        
    # Check and seed Agent
    if not db.query(models.User).filter(models.User.email == agent_email).first():
        db.add(models.User(email=agent_email, password=passwords[office_type]["agent"], role="agent", office_type=office_type))
        
    # Check and seed TV
    if not db.query(models.User).filter(models.User.email == tv_email).first():
        db.add(models.User(email=tv_email, password=passwords[office_type]["tv"], role="tv", office_type=office_type))
        
    db.commit()

    # Also seed historical tokens for wait time predictions
    try:
        seed_historical_tokens(db, office_type)
    except Exception as e:
        db.rollback()
        print(f"[SEED WARNING] Failed to seed historical tokens for {office_type}:", e)

def seed_historical_tokens(db: Session, office_type: str):
    # Check if there are already completed tokens
    count = db.query(func.count(models.Token.id)).filter(
        models.Token.status == "COMPLETED",
        models.Token.office_type == office_type
    ).scalar() or 0
    
    if count >= 20:
        return # Already seeded or has data
        
    import random
    from .ml_model import DEFAULT_SERVICE_TIMES
    
    # Seed 50 completed tokens spread over the last 7 days
    services = {
        "BANK": [("AC", "Account Opening & KYC"), ("CS", "Cash Transactions"), ("AD", "Aadhaar & Loans")],
        "ESEVAI": [("RV", "Revenue Certificates"), ("SS", "Pension Schemes"), ("LD", "Land & Utilities")],
        "POST_OFFICE": [("MP", "Mails & Parcels"), ("SB", "Savings Bank & Money transfer"), ("INS", "Postal Life Insurance"), ("RT", "Retail & Aadhaar")],
        "MUNICIPAL": [("CR", "Civil Registration"), ("TX", "Taxation & Payments"), ("PL", "Permits & Licenses"), ("UG", "Utilities & Grievances")]
    }
    
    office_services = services.get(office_type, services["BANK"])
    
    # Construct base agent email matches seed email patterns
    office_clean = office_type.replace("_", "")
    if office_type == "POST_OFFICE":
        office_clean = "PostOffice"
    elif office_type == "ESEVAI":
        office_clean = "Esevai"
    elif office_type == "MUNICIPAL":
        office_clean = "Municipal"
    elif office_type == "BANK":
        office_clean = "Bank"
    agent_email = f"AgentOf{office_clean}@gmail.com"
        
    now = datetime.datetime.utcnow()
    
    for i in range(50):
        # Pick random day in the last 7 days
        days_ago = random.randint(1, 7)
        hour = random.randint(9, 17) # Business hours
        minute = random.randint(0, 59)
        created_at = now - datetime.timedelta(days=days_ago)
        created_at = created_at.replace(hour=hour, minute=minute, second=0, microsecond=0)
        
        # Pick random service
        svc_code, svc_name = random.choice(office_services)
        
        # Generate token number
        token_num = f"{svc_code}-HIST-{i:03d}"
        
        # Congestion params
        queue_len = random.randint(0, 8)
        active_cnt = random.randint(1, 3)
        counter_assigned = random.randint(1, 3)
        
        # Calculate simulated wait time
        avg_svc = DEFAULT_SERVICE_TIMES.get(svc_code, 5.0)
        # Wait time depends on queue size, active counters, and some randomness
        wait_minutes = (queue_len / max(1, active_cnt)) * avg_svc + random.uniform(1.0, 5.0)
        wait_minutes = max(1.0, wait_minutes)
        
        # Calculate simulated service time
        service_minutes = avg_svc * random.uniform(0.7, 1.3)
        
        served_at = created_at + datetime.timedelta(minutes=wait_minutes)
        completed_at = served_at + datetime.timedelta(minutes=service_minutes)
        
        db_token = models.Token(
            token_number=token_num,
            service_code=svc_code,
            service_name=svc_name,
            customer_info=f"9876543{i:03d}",
            status="COMPLETED",
            counter_assigned=counter_assigned,
            office_type=office_type,
            agent_email=agent_email,
            queue_length_at_creation=queue_len,
            active_counters_at_creation=active_cnt,
            estimated_wait_minutes=round(wait_minutes, 1),
            created_at=created_at,
            served_at=served_at,
            completed_at=completed_at
        )
        db.add(db_token)
        
    db.commit()
    print(f"[SEED] Successfully seeded 50 historical tokens for {office_type}")

