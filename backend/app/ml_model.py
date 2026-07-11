import datetime
from sqlalchemy.orm import Session
from sqlalchemy import func
from . import models

# Default average service times (in minutes) for fallback and simulation
DEFAULT_SERVICE_TIMES = {
    # BANK
    "AC": 12.0, "CS": 4.0, "AD": 15.0,
    # ESEVAI
    "RV": 8.0, "SS": 18.0, "LD": 10.0,
    # POST_OFFICE
    "MP": 3.0, "SB": 7.0, "INS": 14.0, "RT": 8.0,
    # MUNICIPAL
    "CR": 9.0, "TX": 5.0, "PL": 20.0, "UG": 12.0
}

# Encode service codes to numeric features for the machine learning model
SERVICE_ENCODINGS = {
    # BANK
    "AC": 0, "CS": 1, "AD": 2,
    # ESEVAI
    "RV": 3, "SS": 4, "LD": 5,
    # POST_OFFICE
    "MP": 6, "SB": 7, "INS": 8, "RT": 9,
    # MUNICIPAL
    "CR": 10, "TX": 11, "PL": 12, "UG": 13
}

# Try importing scikit-learn for advanced modeling, fallback to pure Python Decision Tree otherwise
try:
    from sklearn.tree import DecisionTreeRegressor
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False


class DecisionTreeRegressorCustom:
    """A lightweight Decision Tree Regressor implemented in pure Python to eliminate dependencies."""
    def __init__(self, max_depth=3, min_samples_split=4):
        self.max_depth = max_depth
        self.min_samples_split = min_samples_split
        self.tree = None

    def fit(self, X, y):
        self.tree = self._build_tree(X, y, depth=0)
        return self

    def _mse(self, y):
        if not y:
            return 0.0
        mean = sum(y) / len(y)
        return sum((val - mean) ** 2 for val in y) / len(y)

    def _split(self, X, y):
        best_mse = float('inf')
        best_criteria = None
        best_sets = None

        n_samples = len(y)
        if n_samples == 0:
            return None, None
            
        n_features = len(X[0]) if X else 0

        for col in range(n_features):
            values = set(row[col] for row in X)
            for val in values:
                left_idx = [i for i in range(n_samples) if X[i][col] <= val]
                right_idx = [i for i in range(n_samples) if X[i][col] > val]

                if not left_idx or not right_idx:
                    continue

                left_y = [y[i] for i in left_idx]
                right_y = [y[i] for i in right_idx]

                mse = (len(left_y) * self._mse(left_y) + len(right_y) * self._mse(right_y)) / n_samples
                if mse < best_mse:
                    best_mse = mse
                    best_criteria = (col, val)
                    best_sets = (left_idx, right_idx)

        return best_criteria, best_sets

    def _build_tree(self, X, y, depth):
        if not y:
            return 0.0
        if depth >= self.max_depth or len(set(y)) == 1 or len(y) < self.min_samples_split:
            return sum(y) / len(y)

        criteria, sets = self._split(X, y)
        if not criteria:
            return sum(y) / len(y)

        col, val = criteria
        left_idx, right_idx = sets

        left_X = [X[i] for i in left_idx]
        left_y = [y[i] for i in left_idx]
        right_X = [X[i] for i in right_idx]
        right_y = [y[i] for i in right_idx]

        left_branch = self._build_tree(left_X, left_y, depth + 1)
        right_branch = self._build_tree(right_X, right_y, depth + 1)

        return {"col": col, "val": val, "left": left_branch, "right": right_branch}

    def predict_one(self, x):
        node = self.tree
        if node is None:
            return 0.0
        while isinstance(node, dict):
            col = node["col"]
            val = node["val"]
            if x[col] <= val:
                node = node["left"]
            else:
                node = node["right"]
        return node

    def predict(self, X):
        return [self.predict_one(x) for x in X]


def get_agent_historical_speed(db: Session, agent_email: str, default_val: float = 5.0) -> float:
    """Calculates an agent's average completed service time in minutes."""
    if not agent_email:
        return default_val
        
    completed_tokens = db.query(models.Token).filter(
        models.Token.agent_email == agent_email,
        models.Token.status == "COMPLETED",
        models.Token.served_at.isnot(None),
        models.Token.completed_at.isnot(None)
    ).all()
    
    if not completed_tokens:
        return default_val
        
    total_duration = sum((t.completed_at - t.served_at).total_seconds() / 60.0 for t in completed_tokens)
    return total_duration / len(completed_tokens)


def get_agent_speed_for_service(db: Session, agent_email: str, service_code: str) -> float:
    """Calculates an agent's historical service speed specifically for a service code."""
    default_val = DEFAULT_SERVICE_TIMES.get(service_code, 8.0)
    if not agent_email:
        return default_val
        
    completed_tokens = db.query(models.Token).filter(
        models.Token.agent_email == agent_email,
        models.Token.service_code == service_code,
        models.Token.status == "COMPLETED",
        models.Token.served_at.isnot(None),
        models.Token.completed_at.isnot(None)
    ).all()
    
    if not completed_tokens:
        # Fall back to general agent speed or default service speed
        return get_agent_historical_speed(db, agent_email, default_val)
        
    total_duration = sum((t.completed_at - t.served_at).total_seconds() / 60.0 for t in completed_tokens)
    return total_duration / len(completed_tokens)


def get_average_active_agents_speed(db: Session, office_type: str) -> float:
    """Calculates average speed of active agents at this office."""
    active_counters = db.query(models.Counter).filter(
        models.Counter.office_type == office_type,
        models.Counter.is_active == True,
        models.Counter.current_agent_email.isnot(None)
    ).all()
    
    speeds = []
    for c in active_counters:
        speeds.append(get_agent_historical_speed(db, c.current_agent_email))
        
    if not speeds:
        return 5.0
    return sum(speeds) / len(speeds)


def predict_wait_time(
    db: Session,
    office_type: str,
    service_code: str,
    queue_length: int,
    active_counters: int,
    assigned_counter_number: int = None
) -> float:
    """Predicts estimated wait time (ETA) for a new token in minutes using ML regression."""
    
    # Fetch historical completed tokens for this office to train the model
    completed = db.query(models.Token).filter(
        models.Token.office_type == office_type,
        models.Token.status == "COMPLETED",
        models.Token.served_at.isnot(None),
        models.Token.created_at.isnot(None)
    ).all()
    
    # Fallback to standard queueing heuristic if there's insufficient historical data
    default_svc_time = DEFAULT_SERVICE_TIMES.get(service_code, 5.0)
    
    if len(completed) < 10:
        # Classical wait time calculation: (queue_length / active_counters) * service_time
        safe_counters = max(1, active_counters)
        wait_est = (queue_length / safe_counters) * default_svc_time
        # Add a tiny base buffer of 1 minute to account for overhead
        return round(max(1.0, wait_est), 1)

    # 1. Prepare ML training features
    X = []
    y = []
    
    # Pre-calculate historical agent speed averages to speed up training
    agent_emails = set(t.agent_email for t in completed if t.agent_email)
    agent_speeds = {email: get_agent_historical_speed(db, email) for email in agent_emails}
    
    for t in completed:
        svc_enc = SERVICE_ENCODINGS.get(t.service_code, -1)
        q_len = t.queue_length_at_creation or 0
        c_count = t.active_counters_at_creation or 1
        hr = t.created_at.hour
        day = t.created_at.weekday()
        
        # Agent speed
        spd = agent_speeds.get(t.agent_email, 5.0)
        
        # Target: wait time in minutes
        wait_time = (t.served_at - t.created_at).total_seconds() / 60.0
        
        X.append([svc_enc, q_len, c_count, hr, day, spd])
        y.append(wait_time)
        
    # 2. Identify current prediction features
    current_agent_email = None
    if assigned_counter_number:
        counter = db.query(models.Counter).filter(
            models.Counter.counter_number == assigned_counter_number,
            models.Counter.office_type == office_type
        ).first()
        if counter:
            current_agent_email = counter.current_agent_email
            
    if current_agent_email:
        curr_agent_spd = get_agent_historical_speed(db, current_agent_email)
    else:
        curr_agent_spd = get_average_active_agents_speed(db, office_type)
        
    now = datetime.datetime.utcnow()
    current_svc_enc = SERVICE_ENCODINGS.get(service_code, -1)
    
    x_pred = [
        current_svc_enc,
        queue_length,
        max(1, active_counters),
        now.hour,
        now.weekday(),
        curr_agent_spd
    ]
    
    # 3. Fit model and predict
    try:
        if HAS_SKLEARN:
            model = DecisionTreeRegressor(max_depth=3, min_samples_split=4)
            model.fit(X, y)
            pred = model.predict([x_pred])[0]
        else:
            model = DecisionTreeRegressorCustom(max_depth=3, min_samples_split=4)
            model.fit(X, y)
            pred = model.predict_one(x_pred)
            
        # Bound prediction to at least 1.0 minute and maximum 120 minutes for safety
        return round(max(1.0, min(120.0, float(pred))), 1)
    except Exception as e:
        print("[ML PREDICTION ERROR] Falling back to heuristic:", e)
        # Final safety fallback
        safe_counters = max(1, active_counters)
        return round(max(1.0, (queue_length / safe_counters) * default_svc_time), 1)
