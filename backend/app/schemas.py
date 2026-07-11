from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class TokenBase(BaseModel):
    service_code: str
    service_name: str
    customer_info: Optional[str] = None
    office_type: Optional[str] = "BANK"

class TokenCreate(TokenBase):
    pass

class Token(TokenBase):
    id: int
    token_number: str
    status: str
    counter_assigned: Optional[int] = None
    agent_email: Optional[str] = None
    queue_length_at_creation: Optional[int] = 0
    active_counters_at_creation: Optional[int] = 1
    estimated_wait_minutes: Optional[float] = None
    created_at: datetime
    served_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class CounterBase(BaseModel):
    counter_number: int
    is_active: bool = True
    office_type: Optional[str] = "BANK"

class CounterCreate(CounterBase):
    pass

class Counter(CounterBase):
    id: int
    current_token_id: Optional[int] = None
    current_agent_email: Optional[str] = None

    class Config:
        from_attributes = True

class UserCreate(BaseModel):
    email: str
    password: str
    office_type: str

class UserLogin(BaseModel):
    email: str
    password: str
    office_type: str

class UserResponse(BaseModel):
    id: int
    email: str
    role: str
    office_type: str

    class Config:
        from_attributes = True

