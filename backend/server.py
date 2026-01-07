from fastapi import FastAPI, APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Depends, status
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
import asyncio
from telethon import TelegramClient, events
from telethon.tl.functions.messages import GetDialogsRequest, AddChatUserRequest, ExportChatInviteRequest, ImportChatInviteRequest
from telethon.tl.functions.channels import InviteToChannelRequest, JoinChannelRequest
from telethon.tl.types import InputPeerEmpty, UserStatusOnline, UserStatusOffline, UserStatusRecently, Channel, Chat, User as TelegramUser
from telethon.errors import SessionPasswordNeededError, PhoneCodeInvalidError, FloodWaitError, UserPrivacyRestrictedError, UserNotMutualContactError, ChatWriteForbiddenError, ChannelPrivateError, UserBannedInChannelError, ChatAdminRequiredError, UserKickedError, UserAlreadyParticipantError, InviteHashExpiredError, InviteHashInvalidError
import random
import json
import jwt
from passlib.context import CryptContext
import sqlite3

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT Configuration
JWT_SECRET = os.environ.get('JWT_SECRET', 'default_secret_key')
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24 * 7  # 7 days

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Security
security = HTTPBearer()

# Store active Telegram clients
active_clients: Dict[str, TelegramClient] = {}

# Store active WebSocket connections for broadcast monitoring
broadcast_connections: Dict[str, List[WebSocket]] = {}

# Store active broadcast tasks
active_broadcasts: Dict[str, Dict] = {}

# Locks para gerenciar acesso às sessões do Telegram (evita "database is locked")
session_locks: Dict[str, asyncio.Lock] = {}
# Rastrear quando cada lock foi adquirido para detectar locks presos
lock_timestamps: Dict[str, datetime] = {}
# Timeout máximo para operações (2 minutos)
MAX_LOCK_TIME = 120

# ============== Gerenciador de Clientes Singleton ==============
# Mantém uma única conexão por conta para evitar erro de IP duplicado

class TelegramClientManager:
    """
    Gerenciador singleton de clientes Telegram.
    Mantém apenas UMA conexão ativa por número de telefone.
    Evita o erro 'authorization key was used under two different IP addresses'
    """
    _clients: Dict[str, TelegramClient] = {}
    _client_locks: Dict[str, asyncio.Lock] = {}
    _client_in_use: Dict[str, bool] = {}
    
    @classmethod
    def get_client_lock(cls, phone: str) -> asyncio.Lock:
        """Obtém ou cria um lock para o cliente"""
        if phone not in cls._client_locks:
            cls._client_locks[phone] = asyncio.Lock()
        return cls._client_locks[phone]
    
    @classmethod
    async def get_client(cls, phone: str, api_id: int, api_hash: str) -> TelegramClient:
        """
        Obtém ou cria um cliente para o telefone.
        Se já existe um cliente conectado, reutiliza.
        """
        lock = cls.get_client_lock(phone)
        
        async with lock:
            # Verificar se já existe cliente conectado
            if phone in cls._clients:
                client = cls._clients[phone]
                try:
                    if client.is_connected():
                        # Verificar se está autorizado
                        if await client.is_user_authorized():
                            logging.info(f"[ClientManager] Reutilizando cliente existente para {phone}")
                            cls._client_in_use[phone] = True
                            return client
                except Exception as e:
                    logging.warning(f"[ClientManager] Cliente existente com problema para {phone}: {e}")
                
                # Cliente existe mas não está funcionando, desconectar
                try:
                    await client.disconnect()
                except:
                    pass
                del cls._clients[phone]
            
            # Criar novo cliente
            logging.info(f"[ClientManager] Criando novo cliente para {phone}")
            session_name = f"sessions/{phone}"
            
            # Configurar SQLite
            try:
                sqlite3.connect(f"{session_name}.session", timeout=30.0).close()
            except:
                pass
            
            client = TelegramClient(
                session_name,
                api_id,
                api_hash,
                connection_retries=3,
                retry_delay=1,
                timeout=30
            )
            
            await client.connect()
            
            if not await client.is_user_authorized():
                await client.disconnect()
                raise Exception(f"Conta {phone} não está autenticada. Por favor, faça login novamente.")
            
            cls._clients[phone] = client
            cls._client_in_use[phone] = True
            return client
    
    @classmethod
    async def release_client(cls, phone: str, disconnect: bool = False):
        """
        Libera o cliente para uso por outras operações.
        Se disconnect=True, desconecta completamente.
        """
        cls._client_in_use[phone] = False
        
        if disconnect and phone in cls._clients:
            try:
                await cls._clients[phone].disconnect()
            except:
                pass
            del cls._clients[phone]
            logging.info(f"[ClientManager] Cliente desconectado para {phone}")
    
    @classmethod
    async def disconnect_all(cls):
        """Desconecta todos os clientes"""
        for phone in list(cls._clients.keys()):
            try:
                await cls._clients[phone].disconnect()
            except:
                pass
        cls._clients.clear()
        cls._client_in_use.clear()
        logging.info(f"[ClientManager] Todos os clientes desconectados")
    
    @classmethod
    def is_client_in_use(cls, phone: str) -> bool:
        """Verifica se o cliente está em uso"""
        return cls._client_in_use.get(phone, False)
    
    @classmethod
    async def invalidate_session(cls, phone: str):
        """
        Invalida a sessão quando há erro de IP.
        Remove o arquivo de sessão para forçar re-login.
        """
        # Desconectar cliente se existir
        if phone in cls._clients:
            try:
                await cls._clients[phone].disconnect()
            except:
                pass
            del cls._clients[phone]
        
        # Remover arquivo de sessão
        session_file = f"sessions/{phone}.session"
        try:
            if os.path.exists(session_file):
                os.remove(session_file)
                logging.warning(f"[ClientManager] Sessão invalidada para {phone}")
            journal_file = f"{session_file}-journal"
            if os.path.exists(journal_file):
                os.remove(journal_file)
        except Exception as e:
            logging.error(f"[ClientManager] Erro ao remover sessão {phone}: {e}")

# Instância global
client_manager = TelegramClientManager

def get_session_lock(phone: str) -> asyncio.Lock:
    """Get or create a lock for a specific phone session"""
    if phone not in session_locks:
        session_locks[phone] = asyncio.Lock()
    return session_locks[phone]

async def force_release_stale_lock(phone: str):
    """Força liberação de lock que está preso há muito tempo"""
    if phone in lock_timestamps:
        lock_time = lock_timestamps[phone]
        elapsed = (datetime.now(timezone.utc) - lock_time).total_seconds()
        if elapsed > MAX_LOCK_TIME:
            # Lock está preso há muito tempo, criar um novo
            logging.warning(f"Forçando liberação de lock preso para {phone} (preso há {elapsed:.0f}s)")
            session_locks[phone] = asyncio.Lock()
            if phone in lock_timestamps:
                del lock_timestamps[phone]
            return True
    return False

def force_release_all_locks():
    """Força liberação de TODOS os locks - usar com cuidado"""
    global session_locks, lock_timestamps
    count = len(session_locks)
    session_locks = {}
    lock_timestamps = {}
    logging.warning(f"Forçada liberação de {count} locks")
    return count

async def safe_acquire_lock(phone: str, timeout_seconds: int = 30):
    """
    Adquire lock de forma segura com timeout e detecção de locks presos.
    Retorna o lock ou None se não conseguir.
    """
    # Primeiro, verifica se há lock preso
    await force_release_stale_lock(phone)
    
    lock = get_session_lock(phone)
    
    # Se lock não está ocupado, adquire imediatamente
    if not lock.locked():
        try:
            await lock.acquire()
            lock_timestamps[phone] = datetime.now(timezone.utc)
            return lock
        except Exception as e:
            logging.error(f"Erro ao adquirir lock para {phone}: {e}")
            # Cria novo lock e tenta novamente
            session_locks[phone] = asyncio.Lock()
            lock = session_locks[phone]
            await lock.acquire()
            lock_timestamps[phone] = datetime.now(timezone.utc)
            return lock
    
    # Lock está ocupado, tenta com timeout
    try:
        acquired = await asyncio.wait_for(lock.acquire(), timeout=timeout_seconds)
        if acquired:
            lock_timestamps[phone] = datetime.now(timezone.utc)
            return lock
    except asyncio.TimeoutError:
        logging.warning(f"Timeout ao adquirir lock para {phone} após {timeout_seconds}s")
        # Verifica se o lock está preso há muito tempo
        was_stale = await force_release_stale_lock(phone)
        if was_stale:
            # Tenta novamente após forçar liberação
            lock = get_session_lock(phone)
            try:
                await lock.acquire()
                lock_timestamps[phone] = datetime.now(timezone.utc)
                return lock
            except:
                pass
        # Última tentativa: criar novo lock
        logging.warning(f"Criando novo lock para {phone} após timeout")
        session_locks[phone] = asyncio.Lock()
        lock = session_locks[phone]
        await lock.acquire()
        lock_timestamps[phone] = datetime.now(timezone.utc)
        return lock
    except Exception as e:
        logging.error(f"Erro inesperado ao adquirir lock para {phone}: {e}")
        # Cria novo lock como fallback
        session_locks[phone] = asyncio.Lock()
        lock = session_locks[phone]
        await lock.acquire()
        lock_timestamps[phone] = datetime.now(timezone.utc)
        return lock
    
    return None

def release_lock(phone: str, lock: asyncio.Lock):
    """Libera lock de forma segura"""
    try:
        if lock and lock.locked():
            lock.release()
        if phone in lock_timestamps:
            del lock_timestamps[phone]
    except RuntimeError as e:
        # Lock já foi liberado
        logging.debug(f"Lock para {phone} já estava liberado: {e}")
    except Exception as e:
        logging.error(f"Erro ao liberar lock para {phone}: {e}")

# Default API credentials (fallback)
DEFAULT_API_CREDENTIALS = [
    {"api_id": 26975297, "api_hash": "ad9a5e7295d458a156ef5769f7c7be42"},
    {"api_id": 26975297, "api_hash": "ad9a5e7295d458a156ef5769f7c7be42"},
    {"api_id": 26975297, "api_hash": "ad9a5e7295d458a156ef5769f7c7be42"},
    {"api_id": 26975297, "api_hash": "ad9a5e7295d458a156ef5769f7c7be42"}
]

# ============== Pydantic Models ==============

# User Models
class UserCreate(BaseModel):
    email: str
    password: str
    name: str

class UserLogin(BaseModel):
    email: str
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    plan: str = "free"
    plan_expires_at: Optional[datetime] = None
    is_admin: bool = False
    created_at: datetime

class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email: str
    password_hash: str
    name: str
    plan: str = "free"  # free, basic, premium
    plan_expires_at: Optional[datetime] = None
    is_admin: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Plan limits configuration
PLAN_LIMITS = {
    "free": {
        "max_accounts": 1,
        "daily_extract_members": 5,
        "daily_send_messages": 5,
        "daily_broadcast_groups": 0,  # Not available
        "daily_add_to_group": 0,  # Not available
        "can_view_groups": True,
    },
    "basic": {
        "max_accounts": 5,
        "daily_extract_members": 50,
        "daily_send_messages": 25,
        "daily_broadcast_groups": 1,  # Once per day for all groups
        "daily_add_to_group": 5,
        "can_view_groups": True,
    },
    "premium": {
        "max_accounts": 999999,
        "daily_extract_members": 999999,
        "daily_send_messages": 999999,
        "daily_broadcast_groups": 999999,
        "daily_add_to_group": 999999,
        "can_view_groups": True,
    }
}

# Daily usage tracking model
class DailyUsage(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    date: str  # YYYY-MM-DD format
    extract_members: int = 0
    send_messages: int = 0
    broadcast_groups: int = 0
    add_to_group: int = 0

async def get_daily_usage(user_id: str) -> dict:
    """Get or create daily usage record for user"""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    usage = await db.daily_usage.find_one({"user_id": user_id, "date": today})
    if not usage:
        usage = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "date": today,
            "extract_members": 0,
            "send_messages": 0,
            "broadcast_groups": 0,
            "add_to_group": 0
        }
        await db.daily_usage.insert_one(usage)
    return usage

async def increment_usage(user_id: str, field: str, amount: int = 1):
    """Increment a usage counter"""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await db.daily_usage.update_one(
        {"user_id": user_id, "date": today},
        {"$inc": {field: amount}},
        upsert=True
    )

async def check_limit(user_id: str, plan: str, action: str, requested_amount: int = 1) -> tuple:
    """Check if user can perform action. Returns (can_do, remaining, message)"""
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    usage = await get_daily_usage(user_id)
    
    limit_map = {
        "extract_members": ("daily_extract_members", "extract_members"),
        "send_messages": ("daily_send_messages", "send_messages"),
        "broadcast_groups": ("daily_broadcast_groups", "broadcast_groups"),
        "add_to_group": ("daily_add_to_group", "add_to_group"),
    }
    
    if action not in limit_map:
        return True, 999999, ""
    
    limit_key, usage_key = limit_map[action]
    max_limit = limits[limit_key]
    current_usage = usage.get(usage_key, 0)
    remaining = max_limit - current_usage
    
    if max_limit == 0:
        if plan == "free":
            return False, 0, f"❌ Esta função não está disponível no plano FREE. Faça upgrade para o plano BÁSICO ou PREMIUM!"
        return False, 0, f"❌ Limite atingido para hoje. Volte amanhã!"
    
    if remaining <= 0:
        return False, 0, f"❌ Limite diário atingido ({max_limit}). Volte amanhã ou faça upgrade do plano!"
    
    if requested_amount > remaining:
        return False, remaining, f"⚠️ Você só pode fazer mais {remaining} hoje. Limite diário: {max_limit}"
    
    return True, remaining, ""

# Account Models
class Account(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str  # Owner of this account
    phone: str
    session_string: Optional[str] = None
    is_active: bool = True
    last_used: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class AccountCreate(BaseModel):
    phone: str

class PhoneCodeRequest(BaseModel):
    phone: str
    phone_code_hash: str
    code: str

# Member Models
class Member(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str  # Owner
    user_telegram_id: int
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    extracted_from: str
    extracted_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_seen: Optional[str] = None

# Group Models
class TelegramGroup(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    account_id: str
    account_phone: str
    telegram_id: int
    title: str
    username: Optional[str] = None
    participants_count: Optional[int] = None
    is_channel: bool = False
    is_megagroup: bool = False
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Message Template Models
class MessageTemplate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    content: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class MessageTemplateCreate(BaseModel):
    name: str
    content: str

class MessageTemplateUpdate(BaseModel):
    name: Optional[str] = None
    content: Optional[str] = None

# Broadcast Models
class BroadcastRequest(BaseModel):
    message: str
    group_ids: Optional[List[str]] = None  # If None, send to all groups
    account_ids: Optional[List[str]] = None  # If None, use all active accounts
    continuous: bool = True  # Loop contínuo (padrão: ativado)

class CopyMessageRequest(BaseModel):
    source_group_id: str
    message_id: int
    target_group_ids: Optional[List[str]] = None  # If None, send to all groups

# Action Log Models
class ActionLog(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    action_type: str
    account_phone: str
    target: str
    status: str
    details: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Public Groups Marketplace Models
class PublicGroup(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    telegram_id: int
    title: str
    username: Optional[str] = None
    invite_link: Optional[str] = None
    participants_count: Optional[int] = None
    is_channel: bool = False
    is_megagroup: bool = False
    added_by_admin: str  # Admin user_id who added this
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class GroupAccessPurchase(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    user_email: str
    user_name: str
    status: str = "pending"  # pending, approved, rejected
    price: float = 14.99
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    approved_at: Optional[datetime] = None
    approved_by: Optional[str] = None

class MessageRequest(BaseModel):
    member_ids: List[str]
    message: str
    delay_min: int = 30
    delay_max: int = 60

class AddToGroupRequest(BaseModel):
    member_ids: List[str]
    group_username: str
    delay_min: int = 30
    delay_max: int = 60

# ============== Authentication Helpers ==============

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    payload = {
        "sub": user_id,
        "exp": expire
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    try:
        token = credentials.credentials
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token inválido")
        
        user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=401, detail="Usuário não encontrado")
        
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expirado")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Token inválido")

# ============== Telegram Helpers ==============

async def get_available_account(user_id: str):
    accounts = await db.accounts.find({
        "user_id": user_id,
        "is_active": True,
        "session_string": {"$ne": None, "$ne": "", "$exists": True}
    }, {"_id": 0}).to_list(100)
    if not accounts:
        return None
    
    accounts.sort(key=lambda x: x.get('last_used', datetime.min.replace(tzinfo=timezone.utc)))
    return accounts[0]

async def create_telegram_client(phone: str, api_id: int, api_hash: str, session_string: str = None, check_auth: bool = True):
    session_name = f"sessions/{phone}"
    
    # Configure SQLite to wait longer for locks
    sqlite3.connect(f"{session_name}.session", timeout=30.0).close()
    
    client = TelegramClient(
        session_name, 
        api_id, 
        api_hash,
        connection_retries=3,
        retry_delay=1,
        timeout=30
    )
    
    try:
        await client.connect()
        
        if check_auth and not await client.is_user_authorized():
            await client.disconnect()
            raise Exception(f"Conta {phone} não está autenticada. Por favor, faça login novamente.")
        
        return client
    except Exception as e:
        try:
            await client.disconnect()
        except:
            pass
        raise e

async def send_broadcast_update(user_id: str, data: dict):
    """Send update to all WebSocket connections for this user"""
    if user_id in broadcast_connections:
        disconnected = []
        for ws in broadcast_connections[user_id]:
            try:
                await ws.send_json(data)
            except:
                disconnected.append(ws)
        # Remove disconnected
        for ws in disconnected:
            broadcast_connections[user_id].remove(ws)

# ============== Auth Routes ==============

@api_router.post("/auth/register")
async def register(input: UserCreate):
    # Check if user already exists
    existing = await db.users.find_one({"email": input.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email já cadastrado")
    
    # Create user
    user = User(
        email=input.email.lower(),
        password_hash=hash_password(input.password),
        name=input.name
    )
    
    doc = user.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.users.insert_one(doc)
    
    # Create token
    token = create_access_token(user.id)
    
    return {
        "token": token,
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name
        }
    }

@api_router.post("/auth/login")
async def login(input: UserLogin):
    user = await db.users.find_one({"email": input.email.lower()}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Email ou senha incorretos")
    
    if not verify_password(input.password, user['password_hash']):
        raise HTTPException(status_code=401, detail="Email ou senha incorretos")
    
    token = create_access_token(user['id'])
    
    return {
        "token": token,
        "user": {
            "id": user['id'],
            "email": user['email'],
            "name": user['name'],
            "is_admin": user.get('is_admin', False),
            "plan": user.get('plan', 'free')
        }
    }

@api_router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    # Get daily usage
    usage = await get_daily_usage(current_user['id'])
    plan = current_user.get('plan', 'free')
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    
    return {
        "id": current_user['id'],
        "email": current_user['email'],
        "name": current_user['name'],
        "plan": plan,
        "plan_expires_at": current_user.get('plan_expires_at'),
        "is_admin": current_user.get('is_admin', False),
        "limits": limits,
        "usage": {
            "extract_members": usage.get('extract_members', 0),
            "send_messages": usage.get('send_messages', 0),
            "broadcast_groups": usage.get('broadcast_groups', 0),
            "add_to_group": usage.get('add_to_group', 0),
        }
    }

# ============== Admin Routes ==============

ADMIN_SECRET = os.environ.get('ADMIN_SECRET', 'admin_super_secret_2024')

@api_router.post("/admin/login")
async def admin_login(email: str = "", password: str = ""):
    """Admin login - special route for admin panel"""
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not pwd_context.verify(password, user['password_hash']):
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    if not user.get('is_admin', False):
        raise HTTPException(status_code=403, detail="Acesso não autorizado")
    
    token = jwt.encode({
        "user_id": user['id'],
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    }, JWT_SECRET, algorithm=JWT_ALGORITHM)
    
    return {"token": token, "user": {"id": user['id'], "email": user['email'], "name": user['name'], "is_admin": True}}

@api_router.get("/admin/users")
async def admin_get_users(current_user: dict = Depends(get_current_user)):
    """Get all users (admin only)"""
    if not current_user.get('is_admin', False):
        raise HTTPException(status_code=403, detail="Acesso não autorizado")
    
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    for user in users:
        if isinstance(user.get('created_at'), str):
            user['created_at'] = datetime.fromisoformat(user['created_at'])
        # Count accounts for each user
        accounts_count = await db.accounts.count_documents({"user_id": user['id']})
        user['accounts_count'] = accounts_count
    return users

@api_router.put("/admin/users/{user_id}/plan")
async def admin_update_plan(user_id: str, plan: str, days: int = 30, current_user: dict = Depends(get_current_user)):
    """Update user plan (admin only)"""
    if not current_user.get('is_admin', False):
        raise HTTPException(status_code=403, detail="Acesso não autorizado")
    
    if plan not in ["free", "basic", "premium"]:
        raise HTTPException(status_code=400, detail="Plano inválido")
    
    expires_at = None
    if plan != "free":
        expires_at = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    
    result = await db.users.update_one(
        {"id": user_id},
        {"$set": {"plan": plan, "plan_expires_at": expires_at}}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    
    return {"message": f"Plano atualizado para {plan}", "expires_at": expires_at}

@api_router.post("/admin/make-admin")
async def make_admin(email: str, secret: str):
    """Make a user admin (requires secret)"""
    if secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Secret inválido")
    
    result = await db.users.update_one(
        {"email": email},
        {"$set": {"is_admin": True}}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    
    return {"message": f"{email} agora é admin"}

@api_router.get("/plans")
async def get_plans():
    """Get available plans with prices"""
    return {
        "plans": [
            {
                "id": "free",
                "name": "FREE",
                "price": 0,
                "price_display": "Grátis",
                "features": [
                    "1 conta ativa",
                    "Extrair 5 membros/dia",
                    "Enviar 5 mensagens/dia",
                    "Visualizar grupos",
                    "❌ Broadcast para grupos",
                    "❌ Adicionar membros ao grupo"
                ]
            },
            {
                "id": "basic",
                "name": "BÁSICO",
                "price": 19.99,
                "price_display": "R$ 19,99/mês",
                "features": [
                    "5 contas ativas",
                    "Extrair 50 membros/dia",
                    "Enviar 25 mensagens/dia",
                    "Broadcast 1x por dia",
                    "Adicionar 5 membros/dia ao grupo",
                    "Limites renovam diariamente"
                ]
            },
            {
                "id": "premium",
                "name": "PREMIUM",
                "price": 119.99,
                "price_display": "R$ 119,99/mês",
                "features": [
                    "✨ TUDO ILIMITADO ✨",
                    "Contas ilimitadas",
                    "Extração ilimitada",
                    "Mensagens ilimitadas",
                    "Broadcast ilimitado",
                    "Adicionar membros ilimitado"
                ]
            }
        ],
        "pix": {
            "key": "08053511597",
            "key_type": "CPF",
            "name": "PIX"
        }
    }

# ============== Session Management Routes ==============

@api_router.post("/sessions/reset-locks")
async def reset_session_locks(current_user: dict = Depends(get_current_user)):
    """Reset all session locks for the current user's accounts"""
    # Get user's accounts
    accounts = await db.accounts.find({"user_id": current_user['id']}, {"_id": 0}).to_list(100)
    
    reset_count = 0
    for account in accounts:
        phone = account.get('phone')
        if phone:
            # Force reset the lock for this phone
            if phone in session_locks:
                session_locks[phone] = asyncio.Lock()
                if phone in lock_timestamps:
                    del lock_timestamps[phone]
                reset_count += 1
            else:
                # Criar lock novo mesmo se não existia
                session_locks[phone] = asyncio.Lock()
                reset_count += 1
    
    logging.info(f"Locks resetados para {reset_count} contas do usuário {current_user['email']}")
    
    return {
        "message": f"Locks resetados para {reset_count} contas",
        "reset_count": reset_count,
        "success": True
    }

@api_router.post("/sessions/reset-all-locks")
async def reset_all_locks(current_user: dict = Depends(get_current_user)):
    """Reset ALL session locks - Admin only or user's own locks"""
    if current_user.get('is_admin', False):
        # Admin pode resetar todos
        count = force_release_all_locks()
        logging.warning(f"Admin {current_user['email']} forçou reset de TODOS os {count} locks")
        return {
            "message": f"TODOS os {count} locks foram resetados",
            "reset_count": count,
            "success": True
        }
    else:
        # Usuário normal só reseta os próprios
        return await reset_session_locks(current_user)

@api_router.get("/sessions/status")
async def get_sessions_status(current_user: dict = Depends(get_current_user)):
    """Get status of all session locks for the current user"""
    accounts = await db.accounts.find({"user_id": current_user['id']}, {"_id": 0}).to_list(100)
    
    status = []
    for account in accounts:
        phone = account.get('phone')
        if phone:
            lock = session_locks.get(phone)
            lock_time = lock_timestamps.get(phone)
            
            lock_status = {
                "phone": phone,
                "is_locked": lock.locked() if lock else False,
                "lock_duration": None
            }
            
            if lock_time:
                elapsed = (datetime.now(timezone.utc) - lock_time).total_seconds()
                lock_status["lock_duration"] = f"{elapsed:.0f}s"
            
            status.append(lock_status)
    
    return {"sessions": status}

# ============== Public Groups Marketplace Routes ==============

@api_router.get("/marketplace/groups")
async def get_marketplace_groups(current_user: dict = Depends(get_current_user)):
    """Get all public groups available in the marketplace"""
    # Check if user has purchased access
    purchase = await db.group_purchases.find_one({
        "user_id": current_user['id'],
        "status": "approved"
    }, {"_id": 0})
    
    has_access = purchase is not None or current_user.get('is_admin', False)
    
    # Get all public groups
    groups = await db.public_groups.find({}, {"_id": 0}).to_list(1000)
    
    # If user doesn't have access, hide invite links
    if not has_access:
        for group in groups:
            group['invite_link'] = None
            group['username'] = None
    
    return {
        "groups": groups,
        "has_access": has_access,
        "price": 14.99,
        "total_groups": len(groups)
    }

@api_router.post("/marketplace/purchase")
async def request_marketplace_purchase(current_user: dict = Depends(get_current_user)):
    """Request purchase of marketplace access"""
    # Check if already has approved purchase
    existing = await db.group_purchases.find_one({
        "user_id": current_user['id'],
        "status": "approved"
    })
    
    if existing:
        raise HTTPException(status_code=400, detail="Você já tem acesso aos grupos!")
    
    # Check if has pending purchase
    pending = await db.group_purchases.find_one({
        "user_id": current_user['id'],
        "status": "pending"
    })
    
    if pending:
        raise HTTPException(status_code=400, detail="Você já tem uma solicitação pendente. Aguarde a aprovação do admin.")
    
    # Create purchase request
    purchase = GroupAccessPurchase(
        user_id=current_user['id'],
        user_email=current_user['email'],
        user_name=current_user.get('name', 'Usuário')
    )
    
    doc = purchase.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.group_purchases.insert_one(doc)
    
    return {
        "message": "Solicitação enviada! Após o pagamento via PIX, o admin irá liberar seu acesso.",
        "purchase_id": purchase.id,
        "price": 14.99,
        "pix_key": "08053511597"
    }

@api_router.get("/marketplace/my-purchase")
async def get_my_purchase(current_user: dict = Depends(get_current_user)):
    """Get current user's purchase status"""
    purchase = await db.group_purchases.find_one({
        "user_id": current_user['id']
    }, {"_id": 0})
    
    return {"purchase": purchase}

@api_router.post("/marketplace/join-group/{group_id}")
async def join_marketplace_group(group_id: str, current_user: dict = Depends(get_current_user)):
    """Join a group from the marketplace"""
    # Check if user has access
    purchase = await db.group_purchases.find_one({
        "user_id": current_user['id'],
        "status": "approved"
    })
    
    if not purchase and not current_user.get('is_admin', False):
        raise HTTPException(status_code=403, detail="Você precisa comprar acesso aos grupos primeiro!")
    
    # Get the group
    group = await db.public_groups.find_one({"id": group_id}, {"_id": 0})
    if not group:
        raise HTTPException(status_code=404, detail="Grupo não encontrado")
    
    # Get user's first active account
    account = await get_available_account(current_user['id'])
    if not account:
        raise HTTPException(status_code=400, detail="Você precisa ter pelo menos uma conta ativa para entrar em grupos")
    
    phone = account['phone']
    
    # Try to join the group
    lock = await safe_acquire_lock(phone, timeout_seconds=30)
    if not lock:
        raise HTTPException(status_code=503, detail="Sessão sendo preparada. Aguarde 5-10 minutos e tente novamente.")
    
    client = None
    try:
        creds = random.choice(DEFAULT_API_CREDENTIALS)
        client = await create_telegram_client(phone, creds['api_id'], creds['api_hash'])
        
        # Try to join by username or invite link
        if group.get('username'):
            entity = await client.get_entity(group['username'])
            await client(JoinChannelRequest(entity))
        elif group.get('invite_link'):
            await client(ImportChatInviteRequest(group['invite_link'].split('/')[-1]))
        else:
            raise HTTPException(status_code=400, detail="Grupo sem link de convite disponível")
        
        return {"message": f"Você entrou no grupo '{group['title']}' com sucesso!"}
        
    except Exception as e:
        error_msg = str(e)
        if "already" in error_msg.lower() or "participant" in error_msg.lower():
            return {"message": f"Você já está no grupo '{group['title']}'!"}
        raise HTTPException(status_code=400, detail=f"Erro ao entrar no grupo: {error_msg}")
    finally:
        if client:
            try:
                await client.disconnect()
            except:
                pass
        release_lock(phone, lock)

# Store for bulk join operations
active_bulk_joins = {}

class BulkJoinRequest(BaseModel):
    group_ids: List[str]
    account_id: str

@api_router.post("/marketplace/join-bulk")
async def start_bulk_join(request: BulkJoinRequest, current_user: dict = Depends(get_current_user)):
    """Start joining multiple groups from the marketplace"""
    # Check if user has access
    purchase = await db.group_purchases.find_one({
        "user_id": current_user['id'],
        "status": "approved"
    })
    
    if not purchase and not current_user.get('is_admin', False):
        raise HTTPException(status_code=403, detail="Você precisa comprar acesso aos grupos primeiro!")
    
    # Get the specified account
    account = await db.accounts.find_one({
        "id": request.account_id,
        "user_id": current_user['id'],
        "is_active": True,
        "session_string": {"$ne": None, "$exists": True}
    }, {"_id": 0})
    
    if not account:
        raise HTTPException(status_code=400, detail="Conta não encontrada ou inativa")
    
    # Get groups
    groups = await db.public_groups.find({"id": {"$in": request.group_ids}}, {"_id": 0}).to_list(500)
    if not groups:
        raise HTTPException(status_code=400, detail="Nenhum grupo encontrado")
    
    # Create operation ID
    operation_id = str(uuid.uuid4())
    
    # Initialize operation status
    active_bulk_joins[operation_id] = {
        "user_id": current_user['id'],
        "account_id": request.account_id,
        "phone": account['phone'],
        "status": "running",
        "total": len(groups),
        "joined": 0,
        "skipped": 0,  # Já estava no grupo
        "errors": 0,
        "current_group": None,
        "flood_wait": None,
        "results": [],
        "started_at": datetime.now(timezone.utc).isoformat()
    }
    
    # Start bulk join task in background
    asyncio.create_task(run_bulk_join(operation_id, current_user['id'], account, groups))
    
    return {
        "operation_id": operation_id,
        "message": f"Iniciando entrada em {len(groups)} grupos...",
        "total": len(groups)
    }

async def run_bulk_join(operation_id: str, user_id: str, account: dict, groups: List[dict]):
    """Background task to join multiple groups"""
    phone = account['phone']
    
    logging.info(f"[BULK JOIN {operation_id}][{phone}] Iniciando para {len(groups)} grupos")
    
    lock = await safe_acquire_lock(phone, timeout_seconds=180)
    if not lock:
        active_bulk_joins[operation_id]['status'] = 'error'
        active_bulk_joins[operation_id]['error'] = "Sessão ocupada"
        logging.error(f"[BULK JOIN {operation_id}][{phone}] Não conseguiu lock")
        return
    
    client = None
    try:
        creds = random.choice(DEFAULT_API_CREDENTIALS)
        client = await create_telegram_client(phone, creds['api_id'], creds['api_hash'])
        
        active_bulk_joins[operation_id]['status'] = 'joining'
        
        for idx, group in enumerate(groups):
            # Check if cancelled
            if active_bulk_joins.get(operation_id, {}).get('status') == 'cancelled':
                logging.info(f"[BULK JOIN {operation_id}][{phone}] Cancelado")
                break
            
            group_title = group.get('title', 'Desconhecido')[:40]
            active_bulk_joins[operation_id]['current_group'] = f"[{idx+1}/{len(groups)}] {group_title}"
            
            result = {
                "group_id": group['id'],
                "title": group_title,
                "status": None,
                "message": None
            }
            
            try:
                # Try to join
                if group.get('username'):
                    entity = await asyncio.wait_for(
                        client.get_entity(group['username']),
                        timeout=15.0
                    )
                    await asyncio.wait_for(
                        client(JoinChannelRequest(entity)),
                        timeout=15.0
                    )
                elif group.get('invite_link'):
                    invite_hash = group['invite_link'].split('/')[-1]
                    if invite_hash.startswith('+'):
                        invite_hash = invite_hash[1:]
                    await asyncio.wait_for(
                        client(ImportChatInviteRequest(invite_hash)),
                        timeout=15.0
                    )
                else:
                    result['status'] = 'error'
                    result['message'] = 'Sem link disponível'
                    active_bulk_joins[operation_id]['errors'] += 1
                    active_bulk_joins[operation_id]['results'].append(result)
                    continue
                
                # Success!
                result['status'] = 'joined'
                result['message'] = 'Entrou com sucesso!'
                active_bulk_joins[operation_id]['joined'] += 1
                logging.info(f"[BULK JOIN {operation_id}][{phone}] ✓ Entrou: {group_title}")
                
                # Delay between joins to avoid flood
                await asyncio.sleep(random.uniform(2, 4))
                
            except FloodWaitError as e:
                wait_seconds = e.seconds
                logging.warning(f"[BULK JOIN {operation_id}][{phone}] FloodWait: {wait_seconds}s")
                
                active_bulk_joins[operation_id]['status'] = 'flood_wait'
                active_bulk_joins[operation_id]['flood_wait'] = wait_seconds
                
                # Wait for flood to pass
                await asyncio.sleep(wait_seconds)
                
                active_bulk_joins[operation_id]['flood_wait'] = None
                active_bulk_joins[operation_id]['status'] = 'joining'
                
                # Retry after flood wait
                try:
                    if group.get('username'):
                        entity = await client.get_entity(group['username'])
                        await client(JoinChannelRequest(entity))
                    elif group.get('invite_link'):
                        invite_hash = group['invite_link'].split('/')[-1]
                        if invite_hash.startswith('+'):
                            invite_hash = invite_hash[1:]
                        await client(ImportChatInviteRequest(invite_hash))
                    
                    result['status'] = 'joined'
                    result['message'] = 'Entrou com sucesso (após espera)!'
                    active_bulk_joins[operation_id]['joined'] += 1
                    logging.info(f"[BULK JOIN {operation_id}][{phone}] ✓ Entrou após flood: {group_title}")
                except Exception as retry_err:
                    error_str = str(retry_err)[:50]
                    result['status'] = 'error'
                    result['message'] = error_str
                    active_bulk_joins[operation_id]['errors'] += 1
                    
            except UserAlreadyParticipantError:
                result['status'] = 'skipped'
                result['message'] = 'Já está no grupo'
                active_bulk_joins[operation_id]['skipped'] += 1
                logging.info(f"[BULK JOIN {operation_id}][{phone}] ⊘ Já estava: {group_title}")
                
            except (ChannelPrivateError, InviteHashExpiredError, InviteHashInvalidError) as e:
                result['status'] = 'error'
                result['message'] = type(e).__name__
                active_bulk_joins[operation_id]['errors'] += 1
                logging.warning(f"[BULK JOIN {operation_id}][{phone}] ✗ Erro: {group_title} - {type(e).__name__}")
                
            except Exception as e:
                error_str = str(e)[:50]
                
                # Check if already in group
                if "already" in error_str.lower() or "participant" in error_str.lower():
                    result['status'] = 'skipped'
                    result['message'] = 'Já está no grupo'
                    active_bulk_joins[operation_id]['skipped'] += 1
                else:
                    result['status'] = 'error'
                    result['message'] = error_str
                    active_bulk_joins[operation_id]['errors'] += 1
            
            active_bulk_joins[operation_id]['results'].append(result)
        
        # Completed
        active_bulk_joins[operation_id]['status'] = 'completed'
        active_bulk_joins[operation_id]['current_group'] = None
        active_bulk_joins[operation_id]['finished_at'] = datetime.now(timezone.utc).isoformat()
        
        joined = active_bulk_joins[operation_id]['joined']
        skipped = active_bulk_joins[operation_id]['skipped']
        errors = active_bulk_joins[operation_id]['errors']
        logging.info(f"[BULK JOIN {operation_id}][{phone}] 🏁 COMPLETO: {joined} entrou | {skipped} já estava | {errors} erros")
        
    except Exception as e:
        error_msg = str(e)[:100]
        logging.error(f"[BULK JOIN {operation_id}][{phone}] ❌ ERRO: {error_msg}")
        active_bulk_joins[operation_id]['status'] = 'error'
        active_bulk_joins[operation_id]['error'] = error_msg
    finally:
        if client:
            try:
                await client.disconnect()
            except:
                pass
        release_lock(phone, lock)

@api_router.get("/marketplace/join-bulk/{operation_id}/status")
async def get_bulk_join_status(operation_id: str, current_user: dict = Depends(get_current_user)):
    """Get status of bulk join operation"""
    if operation_id not in active_bulk_joins:
        raise HTTPException(status_code=404, detail="Operação não encontrada")
    
    operation = active_bulk_joins[operation_id]
    if operation['user_id'] != current_user['id']:
        raise HTTPException(status_code=403, detail="Acesso negado")
    
    return operation

@api_router.post("/marketplace/join-bulk/{operation_id}/cancel")
async def cancel_bulk_join(operation_id: str, current_user: dict = Depends(get_current_user)):
    """Cancel bulk join operation"""
    if operation_id not in active_bulk_joins:
        raise HTTPException(status_code=404, detail="Operação não encontrada")
    
    operation = active_bulk_joins[operation_id]
    if operation['user_id'] != current_user['id']:
        raise HTTPException(status_code=403, detail="Acesso negado")
    
    active_bulk_joins[operation_id]['status'] = 'cancelled'
    return {"message": "Operação cancelada"}

# Admin endpoints for marketplace
@api_router.get("/admin/purchases")
async def get_all_purchases(current_user: dict = Depends(get_current_user)):
    """Get all purchase requests (admin only)"""
    if not current_user.get('is_admin', False):
        raise HTTPException(status_code=403, detail="Acesso negado")
    
    purchases = await db.group_purchases.find({}, {"_id": 0}).to_list(1000)
    
    # Sort by status (pending first) and then by date
    purchases.sort(key=lambda x: (0 if x.get('status') == 'pending' else 1, x.get('created_at', '')), reverse=False)
    
    return {"purchases": purchases}

@api_router.post("/admin/purchases/{purchase_id}/approve")
async def approve_purchase(purchase_id: str, current_user: dict = Depends(get_current_user)):
    """Approve a purchase request (admin only)"""
    if not current_user.get('is_admin', False):
        raise HTTPException(status_code=403, detail="Acesso negado")
    
    result = await db.group_purchases.update_one(
        {"id": purchase_id},
        {"$set": {
            "status": "approved",
            "approved_at": datetime.now(timezone.utc).isoformat(),
            "approved_by": current_user['id']
        }}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada")
    
    return {"message": "Acesso liberado com sucesso!"}

@api_router.post("/admin/purchases/{purchase_id}/reject")
async def reject_purchase(purchase_id: str, current_user: dict = Depends(get_current_user)):
    """Reject a purchase request (admin only)"""
    if not current_user.get('is_admin', False):
        raise HTTPException(status_code=403, detail="Acesso negado")
    
    result = await db.group_purchases.update_one(
        {"id": purchase_id},
        {"$set": {"status": "rejected"}}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada")
    
    return {"message": "Solicitação rejeitada"}

@api_router.post("/admin/sync-public-groups")
async def sync_public_groups(current_user: dict = Depends(get_current_user)):
    """Sync admin's groups to public marketplace (admin only)"""
    if not current_user.get('is_admin', False):
        raise HTTPException(status_code=403, detail="Acesso negado")
    
    # Get admin's accounts
    accounts = await db.accounts.find({"user_id": current_user['id']}, {"_id": 0}).to_list(100)
    
    if not accounts:
        raise HTTPException(status_code=400, detail="Você não tem contas cadastradas")
    
    total_synced = 0
    
    for account in accounts:
        phone = account['phone']
        
        lock = await safe_acquire_lock(phone, timeout_seconds=30)
        if not lock:
            continue
        
        client = None
        try:
            creds = random.choice(DEFAULT_API_CREDENTIALS)
            client = await create_telegram_client(phone, creds['api_id'], creds['api_hash'])
            
            dialogs = await client.get_dialogs()
            
            for dialog in dialogs:
                entity = dialog.entity
                
                if isinstance(entity, (Channel, Chat)):
                    # Get invite link if possible
                    invite_link = None
                    username = getattr(entity, 'username', None)
                    
                    try:
                        if hasattr(client, 'export_chat_invite_link'):
                            invite_link = await client(ExportChatInviteRequest(entity))
                            if hasattr(invite_link, 'link'):
                                invite_link = invite_link.link
                    except:
                        pass
                    
                    # Check if group already exists
                    existing = await db.public_groups.find_one({"telegram_id": entity.id})
                    
                    group_data = {
                        "telegram_id": entity.id,
                        "title": entity.title,
                        "username": username,
                        "invite_link": invite_link,
                        "participants_count": getattr(entity, 'participants_count', None),
                        "is_channel": isinstance(entity, Channel) and not getattr(entity, 'megagroup', False),
                        "is_megagroup": isinstance(entity, Channel) and getattr(entity, 'megagroup', False),
                        "added_by_admin": current_user['id'],
                        "created_at": datetime.now(timezone.utc).isoformat()
                    }
                    
                    if existing:
                        await db.public_groups.update_one(
                            {"telegram_id": entity.id},
                            {"$set": group_data}
                        )
                    else:
                        group_data['id'] = str(uuid.uuid4())
                        await db.public_groups.insert_one(group_data)
                    
                    total_synced += 1
                    
        except Exception as e:
            logging.error(f"Erro ao sincronizar grupos de {phone}: {e}")
        finally:
            if client:
                try:
                    await client.disconnect()
                except:
                    pass
            release_lock(phone, lock)
    
    return {"message": f"Sincronizados {total_synced} grupos para o marketplace!"}

# ============== Account Routes ==============

@api_router.get("/")
async def root():
    return {"message": "Telegram Member Sync API"}

@api_router.post("/accounts", response_model=Account)
async def create_account(input: AccountCreate, current_user: dict = Depends(get_current_user)):
    # Check plan limit for accounts
    plan = current_user.get('plan', 'free')
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    current_accounts = await db.accounts.count_documents({"user_id": current_user['id']})
    
    if current_accounts >= limits['max_accounts']:
        raise HTTPException(
            status_code=403, 
            detail=f"❌ Limite de contas atingido ({limits['max_accounts']}). Faça upgrade do seu plano para adicionar mais contas!"
        )
    
    # Check if account already exists for this user
    existing = await db.accounts.find_one({
        "phone": input.phone,
        "user_id": current_user['id']
    }, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Conta já existe")
    
    account = Account(phone=input.phone, user_id=current_user['id'])
    doc = account.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    if doc.get('last_used'):
        doc['last_used'] = doc['last_used'].isoformat()
    
    await db.accounts.insert_one(doc)
    return account

@api_router.get("/accounts", response_model=List[Account])
async def get_accounts(current_user: dict = Depends(get_current_user)):
    accounts = await db.accounts.find({"user_id": current_user['id']}, {"_id": 0}).to_list(1000)
    for acc in accounts:
        if isinstance(acc.get('created_at'), str):
            acc['created_at'] = datetime.fromisoformat(acc['created_at'])
        if acc.get('last_used') and isinstance(acc['last_used'], str):
            acc['last_used'] = datetime.fromisoformat(acc['last_used'])
    return accounts

@api_router.delete("/accounts/{account_id}")
async def delete_account(account_id: str, current_user: dict = Depends(get_current_user)):
    # First, get the account to retrieve the phone number
    account = await db.accounts.find_one({"id": account_id, "user_id": current_user['id']})
    if not account:
        raise HTTPException(status_code=404, detail="Conta não encontrada")
    
    phone = account.get('phone')
    
    # Disconnect Telegram client if active
    if phone and phone in active_clients:
        try:
            client = active_clients[phone]
            await client.log_out()
            await client.disconnect()
            del active_clients[phone]
            logging.info(f"Cliente Telegram desconectado para {phone}")
        except Exception as e:
            logging.error(f"Erro ao desconectar cliente: {e}")
    
    # Remove session file
    if phone:
        session_file = f"sessions/{phone}.session"
        try:
            if os.path.exists(session_file):
                os.remove(session_file)
                logging.info(f"Arquivo de sessão removido: {session_file}")
            # Also remove journal file if exists
            journal_file = f"{session_file}-journal"
            if os.path.exists(journal_file):
                os.remove(journal_file)
        except Exception as e:
            logging.error(f"Erro ao remover arquivo de sessão: {e}")
    
    # Delete from database
    result = await db.accounts.delete_one({"id": account_id, "user_id": current_user['id']})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Conta não encontrada")
    
    # Also delete related groups
    await db.groups.delete_many({"account_id": account_id, "user_id": current_user['id']})
    
    return {"message": "Conta desconectada e excluída com sucesso"}

# ============== Telegram Auth Routes ==============

@api_router.post("/auth/send-code")
async def send_code(request: AccountCreate, current_user: dict = Depends(get_current_user)):
    phone = request.phone
    
    # Check if this is a new account (not already registered)
    existing = await db.accounts.find_one({
        "phone": phone,
        "user_id": current_user['id']
    }, {"_id": 0})
    
    # If not existing, check plan limit for accounts
    if not existing:
        plan = current_user.get('plan', 'free')
        limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
        current_accounts = await db.accounts.count_documents({"user_id": current_user['id']})
        
        if current_accounts >= limits['max_accounts']:
            raise HTTPException(
                status_code=403, 
                detail=f"❌ Limite de contas atingido ({limits['max_accounts']}). Faça upgrade do seu plano para adicionar mais contas!"
            )
    
    # Usa o novo sistema de lock seguro
    lock = await safe_acquire_lock(phone, timeout_seconds=30)
    if not lock:
        raise HTTPException(
            status_code=503, 
            detail="Sessão sendo preparada. Aguarde 5-10 minutos e tente novamente."
        )
    
    try:
        creds = random.choice(DEFAULT_API_CREDENTIALS)
        client = await create_telegram_client(phone, creds['api_id'], creds['api_hash'], check_auth=False)
        
        result = await client.send_code_request(phone)
        phone_code_hash = result.phone_code_hash
        
        active_clients[phone] = client
        
        return {
            "phone_code_hash": phone_code_hash,
            "message": "Código enviado"
        }
    except Exception as e:
        error_msg = str(e)
        if "database is locked" in error_msg.lower():
            raise HTTPException(status_code=503, detail="Sessão sendo preparada. Aguarde 5-10 minutos e tente novamente.")
        raise HTTPException(status_code=400, detail=error_msg)
    finally:
        release_lock(phone, lock)

@api_router.post("/auth/verify-code")
async def verify_code(request: PhoneCodeRequest, current_user: dict = Depends(get_current_user)):
    try:
        client = active_clients.get(request.phone)
        if not client:
            raise HTTPException(status_code=400, detail="Sessão expirada. Solicite novo código.")
        
        # Double check account limit before creating (in case of race condition)
        existing = await db.accounts.find_one({"phone": request.phone, "user_id": current_user['id']})
        if not existing:
            plan = current_user.get('plan', 'free')
            limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
            current_accounts = await db.accounts.count_documents({"user_id": current_user['id']})
            
            if current_accounts >= limits['max_accounts']:
                raise HTTPException(
                    status_code=403, 
                    detail=f"❌ Limite de contas atingido ({limits['max_accounts']}). Faça upgrade do seu plano para adicionar mais contas!"
                )
        
        await client.sign_in(request.phone, request.code, phone_code_hash=request.phone_code_hash)
        
        session_file = f"sessions/{request.phone}.session"
        
        account = Account(
            phone=request.phone,
            user_id=current_user['id'],
            session_string="authenticated",
            is_active=True,
            last_used=None
        )
        
        account_doc = account.model_dump()
        account_doc['created_at'] = account_doc['created_at'].isoformat()
        if account_doc.get('last_used'):
            account_doc['last_used'] = account_doc['last_used'].isoformat()
        
        existing = await db.accounts.find_one({"phone": request.phone, "user_id": current_user['id']})
        if existing:
            await db.accounts.update_one(
                {"phone": request.phone, "user_id": current_user['id']},
                {"$set": {
                    "session_string": "authenticated",
                    "is_active": True
                }}
            )
        else:
            await db.accounts.insert_one(account_doc)
        
        return {"message": "Autenticação bem-sucedida", "phone": request.phone}
    except PhoneCodeInvalidError:
        raise HTTPException(status_code=400, detail="Código inválido")
    except SessionPasswordNeededError:
        raise HTTPException(status_code=400, detail="Verificação em duas etapas ativada. Não suportado no momento.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ============== Groups Routes ==============

@api_router.get("/accounts/{account_id}/groups")
async def get_account_groups(account_id: str, refresh: bool = False, current_user: dict = Depends(get_current_user)):
    """Get all groups for a specific account"""
    account = await db.accounts.find_one({"id": account_id, "user_id": current_user['id']}, {"_id": 0})
    if not account:
        raise HTTPException(status_code=404, detail="Conta não encontrada")
    
    if not account.get('session_string'):
        raise HTTPException(status_code=400, detail="Conta não autenticada")
    
    # Check if we need to refresh from Telegram
    if refresh:
        phone = account['phone']
        
        # Tenta adquirir o lock com timeout maior e detecção de lock preso
        lock = await safe_acquire_lock(phone, timeout_seconds=30)
        if not lock:
            raise HTTPException(
                status_code=503, 
                detail="Sessão sendo preparada. Aguarde 5-10 minutos e tente novamente."
            )
        
        client = None
        try:
            creds = random.choice(DEFAULT_API_CREDENTIALS)
            client = await create_telegram_client(phone, creds['api_id'], creds['api_hash'])
            
            # Get all dialogs (chats, groups, channels)
            dialogs = await client.get_dialogs()
            
            # Delete old groups for this account
            await db.groups.delete_many({"account_id": account_id, "user_id": current_user['id']})
            
            groups = []
            is_admin = current_user.get('is_admin', False)
            
            for dialog in dialogs:
                entity = dialog.entity
                
                # Only include groups and channels (not private chats)
                if isinstance(entity, (Channel, Chat)):
                    is_channel = isinstance(entity, Channel) and not getattr(entity, 'megagroup', False)
                    is_megagroup = isinstance(entity, Channel) and getattr(entity, 'megagroup', False)
                    
                    # Get invite link for admin
                    invite_link = None
                    username = getattr(entity, 'username', None)
                    
                    if is_admin:
                        try:
                            result = await client(ExportChatInviteRequest(entity))
                            if hasattr(result, 'link'):
                                invite_link = result.link
                        except:
                            pass
                    
                    group = TelegramGroup(
                        user_id=current_user['id'],
                        account_id=account_id,
                        account_phone=account['phone'],
                        telegram_id=entity.id,
                        title=entity.title,
                        username=username,
                        participants_count=getattr(entity, 'participants_count', None),
                        is_channel=is_channel,
                        is_megagroup=is_megagroup
                    )
                    
                    doc = group.model_dump()
                    doc['updated_at'] = doc['updated_at'].isoformat()
                    await db.groups.insert_one(doc)
                    groups.append(group)
                    
                    # Se for admin, sincroniza com o marketplace automaticamente
                    if is_admin:
                        existing_public = await db.public_groups.find_one({"telegram_id": entity.id})
                        
                        public_group_data = {
                            "telegram_id": entity.id,
                            "title": entity.title,
                            "username": username,
                            "invite_link": invite_link,
                            "participants_count": getattr(entity, 'participants_count', None),
                            "is_channel": is_channel,
                            "is_megagroup": is_megagroup,
                            "added_by_admin": current_user['id'],
                            "created_at": datetime.now(timezone.utc).isoformat()
                        }
                        
                        if existing_public:
                            await db.public_groups.update_one(
                                {"telegram_id": entity.id},
                                {"$set": public_group_data}
                            )
                        else:
                            public_group_data['id'] = str(uuid.uuid4())
                            await db.public_groups.insert_one(public_group_data)
            
            # Update account last_used
            await db.accounts.update_one(
                {"id": account_id},
                {"$set": {"last_used": datetime.now(timezone.utc).isoformat()}}
            )
            
            return groups
            
        except Exception as e:
            error_msg = str(e)
            if "database is locked" in error_msg.lower():
                raise HTTPException(status_code=503, detail="Sessão sendo preparada. Aguarde 5-10 minutos e tente novamente.")
            raise HTTPException(status_code=400, detail=error_msg)
        finally:
            # Sempre desconecta o cliente e libera o lock
            if client:
                try:
                    await client.disconnect()
                except:
                    pass
            release_lock(phone, lock)
    
    # Return cached groups
    groups = await db.groups.find({"account_id": account_id, "user_id": current_user['id']}, {"_id": 0}).to_list(1000)
    for g in groups:
        if isinstance(g.get('updated_at'), str):
            g['updated_at'] = datetime.fromisoformat(g['updated_at'])
    return groups

@api_router.get("/groups")
async def get_all_groups(current_user: dict = Depends(get_current_user)):
    """Get all groups from all accounts"""
    groups = await db.groups.find({"user_id": current_user['id']}, {"_id": 0}).to_list(10000)
    for g in groups:
        if isinstance(g.get('updated_at'), str):
            g['updated_at'] = datetime.fromisoformat(g['updated_at'])
    return groups

# ============== Message Templates Routes ==============

@api_router.post("/templates", response_model=MessageTemplate)
async def create_template(input: MessageTemplateCreate, current_user: dict = Depends(get_current_user)):
    template = MessageTemplate(
        user_id=current_user['id'],
        name=input.name,
        content=input.content
    )
    
    doc = template.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.templates.insert_one(doc)
    
    return template

@api_router.get("/templates", response_model=List[MessageTemplate])
async def get_templates(current_user: dict = Depends(get_current_user)):
    templates = await db.templates.find({"user_id": current_user['id']}, {"_id": 0}).to_list(1000)
    for t in templates:
        if isinstance(t.get('created_at'), str):
            t['created_at'] = datetime.fromisoformat(t['created_at'])
        if isinstance(t.get('updated_at'), str):
            t['updated_at'] = datetime.fromisoformat(t['updated_at'])
    return templates

@api_router.put("/templates/{template_id}", response_model=MessageTemplate)
async def update_template(template_id: str, input: MessageTemplateUpdate, current_user: dict = Depends(get_current_user)):
    template = await db.templates.find_one({"id": template_id, "user_id": current_user['id']}, {"_id": 0})
    if not template:
        raise HTTPException(status_code=404, detail="Template não encontrado")
    
    update_data = {}
    if input.name:
        update_data['name'] = input.name
    if input.content:
        update_data['content'] = input.content
    update_data['updated_at'] = datetime.now(timezone.utc).isoformat()
    
    await db.templates.update_one({"id": template_id}, {"$set": update_data})
    
    updated = await db.templates.find_one({"id": template_id}, {"_id": 0})
    if isinstance(updated.get('created_at'), str):
        updated['created_at'] = datetime.fromisoformat(updated['created_at'])
    if isinstance(updated.get('updated_at'), str):
        updated['updated_at'] = datetime.fromisoformat(updated['updated_at'])
    return updated

@api_router.delete("/templates/{template_id}")
async def delete_template(template_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.templates.delete_one({"id": template_id, "user_id": current_user['id']})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Template não encontrado")
    return {"message": "Template excluído"}

# ============== Broadcast Routes ==============

@api_router.post("/broadcast/groups")
async def broadcast_to_groups(request: BroadcastRequest, current_user: dict = Depends(get_current_user)):
    """Start CONTINUOUS broadcasting - disparo contínuo em loop até cancelar"""
    user_id = current_user['id']
    
    # Check plan limits
    plan = current_user.get('plan', 'free')
    can_do, remaining, message = await check_limit(user_id, plan, "broadcast_groups")
    if not can_do:
        raise HTTPException(status_code=403, detail=message)
    
    # Get ALL active accounts with valid sessions
    account_query = {"user_id": user_id, "is_active": True, "session_string": {"$ne": None, "$exists": True}}
    if request.account_ids:
        account_query["id"] = {"$in": request.account_ids}
    
    accounts = await db.accounts.find(account_query, {"_id": 0}).to_list(100)
    if not accounts:
        raise HTTPException(status_code=400, detail="Nenhuma conta ativa disponível")
    
    # Get groups
    group_query = {"user_id": user_id}
    if request.group_ids:
        group_query["id"] = {"$in": request.group_ids}
    
    groups = await db.groups.find(group_query, {"_id": 0}).to_list(10000)
    if not groups:
        raise HTTPException(status_code=400, detail="Nenhum grupo encontrado. Atualize a lista de grupos primeiro.")
    
    # Create unique groups list
    unique_groups = {}
    for group in groups:
        tid = group['telegram_id']
        if tid not in unique_groups:
            unique_groups[tid] = group
    
    groups_list = list(unique_groups.values())
    
    # Update usage
    await increment_usage(user_id, "broadcast_groups", 1)
    
    # Create broadcast ID
    broadcast_id = str(uuid.uuid4())
    
    # Initialize broadcast status
    active_broadcasts[broadcast_id] = {
        "user_id": user_id,
        "status": "running",
        "mode": "continuous" if request.continuous else "single",
        "accounts": {},
        "total_groups": len(groups_list),
        "total_accounts": len(accounts),
        "sent_count": 0,
        "error_count": 0,
        "rounds_completed": 0,
        "started_at": datetime.now(timezone.utc).isoformat()
    }
    
    # Start continuous broadcast task
    asyncio.create_task(run_continuous_broadcast(
        broadcast_id, user_id, accounts, groups_list, request.message, request.continuous
    ))
    
    return {
        "broadcast_id": broadcast_id,
        "message": f"🚀 Disparo {'contínuo' if request.continuous else 'único'} iniciado!",
        "total_accounts": len(accounts),
        "total_groups": len(groups_list),
        "mode": "continuous" if request.continuous else "single"
    }

async def run_continuous_broadcast(broadcast_id: str, user_id: str, accounts: List[dict], 
                                    groups: List[dict], message: str, continuous: bool = True):
    """
    DISPARO CONTÍNUO - Loop infinito até cancelar
    Cada conta mantém conexão aberta e dispara continuamente
    CADA CONTA TRABALHA INDEPENDENTEMENTE - não espera outras contas
    """
    try:
        logging.info(f"[DISPARO {broadcast_id}] 🚀 INICIANDO DISPARO CONTÍNUO")
        logging.info(f"[DISPARO {broadcast_id}] {len(accounts)} contas | {len(groups)} grupos | Modo: {'CONTÍNUO' if continuous else 'ÚNICO'}")
        
        # Cada conta vai trabalhar independentemente em paralelo
        # NÃO espera outras contas terminarem - cada uma faz seu loop infinito
        tasks = []
        for account in accounts:
            # Criar task para cada conta - trabalha independentemente
            task = asyncio.create_task(account_continuous_worker(
                broadcast_id, user_id, account, groups.copy(), message, continuous
            ))
            tasks.append(task)
        
        # Loop principal - monitora até todas as contas pararem ou cancelamento
        while True:
            # Verificar cancelamento
            if active_broadcasts.get(broadcast_id, {}).get('status') == 'cancelled':
                logging.info(f"[DISPARO {broadcast_id}] 🛑 Cancelamento detectado - parando todas as contas")
                # Cancelar todas as tasks
                for task in tasks:
                    if not task.done():
                        task.cancel()
                break
            
            # Verificar se todas as tasks terminaram
            all_done = all(task.done() for task in tasks)
            if all_done:
                logging.info(f"[DISPARO {broadcast_id}] Todas as contas finalizaram")
                break
            
            # Pequena pausa para não sobrecarregar o loop
            await asyncio.sleep(1)
        
        # Aguardar tasks terminarem (com timeout)
        try:
            await asyncio.wait_for(
                asyncio.gather(*tasks, return_exceptions=True),
                timeout=10.0
            )
        except asyncio.TimeoutError:
            logging.warning(f"[DISPARO {broadcast_id}] Timeout aguardando tasks")
        
        # Se chegou aqui, foi cancelado ou terminou
        if broadcast_id in active_broadcasts:
            if active_broadcasts[broadcast_id]['status'] != 'cancelled':
                active_broadcasts[broadcast_id]['status'] = 'completed'
            active_broadcasts[broadcast_id]['finished_at'] = datetime.now(timezone.utc).isoformat()
            
            await send_broadcast_update(user_id, {
                "type": "broadcast_complete",
                "broadcast_id": broadcast_id,
                "data": active_broadcasts[broadcast_id]
            })
            
            logging.info(f"[DISPARO {broadcast_id}] ✅ FINALIZADO: {active_broadcasts[broadcast_id]['sent_count']} enviadas | {active_broadcasts[broadcast_id]['rounds_completed']} rodadas")
            
    except Exception as e:
        logging.error(f"[DISPARO {broadcast_id}] ❌ ERRO GERAL: {e}")
        if broadcast_id in active_broadcasts:
            active_broadcasts[broadcast_id]['status'] = 'error'
            active_broadcasts[broadcast_id]['error'] = str(e)

async def account_continuous_worker(broadcast_id: str, user_id: str, account: dict, 
                                     groups: List[dict], message: str, continuous: bool):
    """
    Worker contínuo para uma conta específica
    Usa o ClientManager para evitar erro de múltiplos IPs
    Mantém conexão aberta e dispara em loop INFINITO até cancelar
    """
    phone = account['phone']
    
    logging.info(f"[DISPARO {broadcast_id}][{phone}] 🔄 Worker iniciando...")
    
    # Lista de grupos bloqueados para esta conta (erros permanentes)
    blocked_groups = set()  # telegram_ids de grupos que não podem receber mensagens
    
    # Initialize account status
    if broadcast_id in active_broadcasts:
        active_broadcasts[broadcast_id]['accounts'][phone] = {
            "status": "connecting",
            "current_group": None,
            "sent": 0,
            "errors": 0,
            "skipped": 0,
            "blocked": 0,
            "total": len(groups),
            "active_groups": len(groups),
            "round": 0,
            "flood_wait": None,
            "flood_wait_until": None,
            "last_error": None,
            "blocked_groups": []
        }
    
    await send_broadcast_update(user_id, {
        "type": "account_status",
        "broadcast_id": broadcast_id,
        "phone": phone,
        "data": active_broadcasts[broadcast_id]['accounts'][phone]
    })
    
    client = None
    try:
        creds = random.choice(DEFAULT_API_CREDENTIALS)
        
        # Usar o ClientManager para obter cliente único
        for attempt in range(3):
            try:
                client = await client_manager.get_client(phone, creds['api_id'], creds['api_hash'])
                break
            except Exception as e:
                error_str = str(e).lower()
                
                # Se for erro de IP duplicado, invalidar sessão e pedir re-login
                if "two different ip" in error_str or "authorization key" in error_str:
                    logging.error(f"[DISPARO {broadcast_id}][{phone}] ❌ Erro de sessão: {e}")
                    await client_manager.invalidate_session(phone)
                    
                    # Marcar conta como precisando re-autenticação
                    await db.accounts.update_one(
                        {"phone": phone},
                        {"$set": {"session_string": None, "is_active": False}}
                    )
                    
                    if broadcast_id in active_broadcasts:
                        active_broadcasts[broadcast_id]['accounts'][phone]['status'] = 'session_error'
                        active_broadcasts[broadcast_id]['accounts'][phone]['last_error'] = "Sessão expirada - refaça o login"
                    
                    await send_broadcast_update(user_id, {
                        "type": "account_error",
                        "broadcast_id": broadcast_id,
                        "phone": phone,
                        "error": "Sessão expirada - refaça o login na aba Contas"
                    })
                    return
                
                logging.warning(f"[DISPARO {broadcast_id}][{phone}] Tentativa {attempt+1} falhou: {e}")
                if attempt == 2:
                    raise
                await asyncio.sleep(3)
        
        if not client:
            raise Exception("Falha ao conectar")
        
        logging.info(f"[DISPARO {broadcast_id}][{phone}] ✅ Conectado! Iniciando disparos...")
        active_broadcasts[broadcast_id]['accounts'][phone]['status'] = 'sending'
        
        round_num = 0
        consecutive_all_blocked_rounds = 0
        
        # LOOP INFINITO até cancelar
        while True:
            # Verificar se foi cancelado
            if active_broadcasts.get(broadcast_id, {}).get('status') == 'cancelled':
                logging.info(f"[DISPARO {broadcast_id}][{phone}] 🛑 Cancelado pelo usuário")
                break
            
            round_num += 1
            active_broadcasts[broadcast_id]['accounts'][phone]['round'] = round_num
            
            # Filtrar grupos ativos (remover bloqueados)
            active_groups = [g for g in groups if g.get('telegram_id') not in blocked_groups]
            
            # Se não tem mais grupos ativos em modo contínuo, aguardar e continuar
            if not active_groups:
                if continuous:
                    consecutive_all_blocked_rounds += 1
                    logging.info(f"[DISPARO {broadcast_id}][{phone}] ⚠️ Todos os {len(blocked_groups)} grupos bloqueados - aguardando 30s")
                    active_broadcasts[broadcast_id]['accounts'][phone]['status'] = 'waiting_all_blocked'
                    active_broadcasts[broadcast_id]['accounts'][phone]['active_groups'] = 0
                    
                    for _ in range(30):
                        if active_broadcasts.get(broadcast_id, {}).get('status') == 'cancelled':
                            break
                        await asyncio.sleep(1)
                    
                    if consecutive_all_blocked_rounds >= 10:
                        logging.info(f"[DISPARO {broadcast_id}][{phone}] ⏳ Muitas rodadas bloqueadas - pausa de 2min")
                        for _ in range(120):
                            if active_broadcasts.get(broadcast_id, {}).get('status') == 'cancelled':
                                break
                            await asyncio.sleep(1)
                        consecutive_all_blocked_rounds = 0
                    
                    continue
                else:
                    logging.info(f"[DISPARO {broadcast_id}][{phone}] ⚠️ Todos os grupos bloqueados - finalizando")
                    active_broadcasts[broadcast_id]['accounts'][phone]['status'] = 'all_blocked'
                    break
            
            consecutive_all_blocked_rounds = 0
            active_broadcasts[broadcast_id]['accounts'][phone]['active_groups'] = len(active_groups)
            
            shuffled_groups = active_groups.copy()
            random.shuffle(shuffled_groups)
            
            logging.info(f"[DISPARO {broadcast_id}][{phone}] 🔄 Rodada {round_num} - {len(shuffled_groups)} grupos ativos ({len(blocked_groups)} bloqueados)")
            
            # Disparar para cada grupo
            for idx, group in enumerate(shuffled_groups):
                # Verificar cancelamento a cada grupo
                if active_broadcasts.get(broadcast_id, {}).get('status') == 'cancelled':
                    break
                
                group_title = group.get('title', 'Desconhecido')[:40]
                group_tid = group.get('telegram_id')
                
                # Pular se grupo foi bloqueado durante esta rodada
                if group_tid in blocked_groups:
                    continue
                
                try:
                    # Atualizar status
                    active_broadcasts[broadcast_id]['accounts'][phone]['current_group'] = f"[{idx+1}/{len(shuffled_groups)}] {group_title}"
                    active_broadcasts[broadcast_id]['accounts'][phone]['status'] = 'sending'
                    
                    # Enviar mensagem
                    entity = await asyncio.wait_for(
                        client.get_entity(group_tid),
                        timeout=10.0
                    )
                    
                    await asyncio.wait_for(
                        client.send_message(entity, message),
                        timeout=10.0
                    )
                    
                    # Sucesso!
                    active_broadcasts[broadcast_id]['accounts'][phone]['sent'] += 1
                    active_broadcasts[broadcast_id]['sent_count'] += 1
                    
                    # Delay mínimo entre mensagens
                    await asyncio.sleep(random.uniform(0.5, 1.5))
                    
                except FloodWaitError as e:
                    # FloodWait é temporário - aguardar e continuar
                    wait_seconds = e.seconds
                    logging.warning(f"[DISPARO {broadcast_id}][{phone}] ⏳ FloodWait: {wait_seconds}s (temporário)")
                    
                    active_broadcasts[broadcast_id]['accounts'][phone]['status'] = 'flood_wait'
                    active_broadcasts[broadcast_id]['accounts'][phone]['flood_wait'] = wait_seconds
                    active_broadcasts[broadcast_id]['accounts'][phone]['flood_wait_until'] = (
                        datetime.now(timezone.utc) + timedelta(seconds=wait_seconds)
                    ).isoformat()
                    
                    await send_broadcast_update(user_id, {
                        "type": "flood_wait",
                        "broadcast_id": broadcast_id,
                        "phone": phone,
                        "wait_seconds": wait_seconds,
                        "data": active_broadcasts[broadcast_id]['accounts'][phone]
                    })
                    
                    # Aguardar o tempo exato do flood
                    await asyncio.sleep(wait_seconds)
                    
                    active_broadcasts[broadcast_id]['accounts'][phone]['flood_wait'] = None
                    active_broadcasts[broadcast_id]['accounts'][phone]['flood_wait_until'] = None
                    active_broadcasts[broadcast_id]['accounts'][phone]['status'] = 'sending'
                    
                    # Tentar enviar novamente após flood
                    try:
                        entity = await client.get_entity(group_tid)
                        await client.send_message(entity, message)
                        active_broadcasts[broadcast_id]['accounts'][phone]['sent'] += 1
                        active_broadcasts[broadcast_id]['sent_count'] += 1
                    except Exception as retry_err:
                        active_broadcasts[broadcast_id]['accounts'][phone]['errors'] += 1
                        active_broadcasts[broadcast_id]['error_count'] += 1
                    
                except (ChatWriteForbiddenError, ChannelPrivateError, UserBannedInChannelError, 
                        UserKickedError, ChatAdminRequiredError) as e:
                    # ERRO PERMANENTE - Bloquear grupo
                    error_type = type(e).__name__
                    blocked_groups.add(group_tid)
                    active_broadcasts[broadcast_id]['accounts'][phone]['blocked'] += 1
                    active_broadcasts[broadcast_id]['accounts'][phone]['blocked_groups'].append({
                        "title": group_title,
                        "telegram_id": group_tid,
                        "reason": error_type
                    })
                    logging.info(f"[DISPARO {broadcast_id}][{phone}] 🚫 BLOQUEADO: {group_title} ({error_type})")
                    
                except asyncio.TimeoutError:
                    # Timeout é temporário - não bloquear
                    active_broadcasts[broadcast_id]['accounts'][phone]['errors'] += 1
                    active_broadcasts[broadcast_id]['error_count'] += 1
                    
                except Exception as e:
                    error_str = str(e)[:100]
                    
                    # Verificar se é erro permanente de permissão
                    permanent_errors = [
                        "chat_write_forbidden", "channel_private", "user_banned", 
                        "user_kicked", "chat_admin_required", "user_not_participant",
                        "peer_flood", "you can't write", "not a member", "was kicked",
                        "was banned", "not have permission", "forbidden", "private"
                    ]
                    
                    is_permanent = any(err in error_str.lower() for err in permanent_errors)
                    
                    if is_permanent:
                        # ERRO PERMANENTE - Bloquear grupo
                        blocked_groups.add(group_tid)
                        active_broadcasts[broadcast_id]['accounts'][phone]['blocked'] += 1
                        active_broadcasts[broadcast_id]['accounts'][phone]['blocked_groups'].append({
                            "title": group_title,
                            "telegram_id": group_tid,
                            "reason": error_str[:50]
                        })
                        logging.info(f"[DISPARO {broadcast_id}][{phone}] 🚫 BLOQUEADO: {group_title} ({error_str[:50]})")
                    else:
                        # Erro temporário - apenas contabilizar
                        active_broadcasts[broadcast_id]['accounts'][phone]['errors'] += 1
                        active_broadcasts[broadcast_id]['error_count'] += 1
                        active_broadcasts[broadcast_id]['accounts'][phone]['last_error'] = error_str[:50]
                    
                    # Se erro crítico de autenticação, parar worker
                    if "not authorized" in error_str.lower() or "auth key" in error_str.lower():
                        logging.error(f"[DISPARO {broadcast_id}][{phone}] ❌ Erro de autenticação: {error_str}")
                        break
            
            # Fim da rodada
            active_broadcasts[broadcast_id]['rounds_completed'] += 1
            
            sent = active_broadcasts[broadcast_id]['accounts'][phone]['sent']
            blocked_count = len(blocked_groups)
            active_count = len(active_groups)
            logging.info(f"[DISPARO {broadcast_id}][{phone}] ✅ Rodada {round_num} completa! Enviados: {sent} | Ativos: {active_count} | Bloqueados: {blocked_count}")
            
            await send_broadcast_update(user_id, {
                "type": "round_complete",
                "broadcast_id": broadcast_id,
                "phone": phone,
                "round": round_num,
                "active_groups": active_count,
                "blocked_groups": blocked_count,
                "data": active_broadcasts[broadcast_id]['accounts'][phone]
            })
            
            # Se não é modo contínuo, parar após primeira rodada
            if not continuous:
                logging.info(f"[DISPARO {broadcast_id}][{phone}] Modo único - finalizando")
                break
            
            # MODO CONTÍNUO: Reiniciar imediatamente sem pausa longa
            # Pequena pausa mínima apenas para não sobrecarregar
            await asyncio.sleep(random.uniform(0.3, 0.8))
            
            # Indicar que está reiniciando
            active_broadcasts[broadcast_id]['accounts'][phone]['status'] = 'restarting'
            active_broadcasts[broadcast_id]['accounts'][phone]['current_group'] = f"🔄 Reiniciando rodada {round_num + 1}..."
            
            logging.info(f"[DISPARO {broadcast_id}][{phone}] 🔄 REINICIANDO imediatamente para rodada {round_num + 1}")
        
        # Worker finalizado (só chega aqui se foi cancelado ou modo único)
        final_status = active_broadcasts[broadcast_id]['accounts'][phone].get('status', 'unknown')
        if final_status not in ['all_blocked', 'waiting_all_blocked', 'cancelled']:
            active_broadcasts[broadcast_id]['accounts'][phone]['status'] = 'completed'
        active_broadcasts[broadcast_id]['accounts'][phone]['current_group'] = None
        
        total_sent = active_broadcasts[broadcast_id]['accounts'][phone]['sent']
        total_rounds = active_broadcasts[broadcast_id]['accounts'][phone]['round']
        total_blocked = active_broadcasts[broadcast_id]['accounts'][phone]['blocked']
        logging.info(f"[DISPARO {broadcast_id}][{phone}] 🏁 FINALIZADO: {total_sent} enviados | {total_rounds} rodadas | {total_blocked} bloqueados")
        
        await send_broadcast_update(user_id, {
            "type": "account_complete",
            "broadcast_id": broadcast_id,
            "phone": phone,
            "data": active_broadcasts[broadcast_id]['accounts'][phone]
        })
        
    except Exception as e:
        error_msg = str(e)[:100]
        logging.error(f"[DISPARO {broadcast_id}][{phone}] ❌ ERRO CRÍTICO: {error_msg}")
        
        if broadcast_id in active_broadcasts:
            active_broadcasts[broadcast_id]['accounts'][phone]['status'] = 'error'
            active_broadcasts[broadcast_id]['accounts'][phone]['last_error'] = error_msg
            
            await send_broadcast_update(user_id, {
                "type": "account_error",
                "broadcast_id": broadcast_id,
                "phone": phone,
                "error": error_msg
            })
    
    finally:
        # Sempre desconectar e liberar lock
        if client:
            try:
                await client.disconnect()
            except:
                pass
        release_lock(phone, lock)

@api_router.get("/broadcast/{broadcast_id}/status")
async def get_broadcast_status(broadcast_id: str, current_user: dict = Depends(get_current_user)):
    """Get current status of a broadcast"""
    if broadcast_id not in active_broadcasts:
        raise HTTPException(status_code=404, detail="Broadcast não encontrado")
    
    broadcast = active_broadcasts[broadcast_id]
    if broadcast['user_id'] != current_user['id']:
        raise HTTPException(status_code=403, detail="Acesso negado")
    
    return broadcast

@api_router.get("/broadcast/active/list")
async def get_active_broadcasts(current_user: dict = Depends(get_current_user)):
    """Get all active broadcasts for the current user"""
    user_id = current_user['id']
    
    user_broadcasts = []
    for broadcast_id, broadcast in active_broadcasts.items():
        if broadcast['user_id'] == user_id and broadcast['status'] == 'running':
            user_broadcasts.append({
                "broadcast_id": broadcast_id,
                **broadcast
            })
    
    return {
        "active_broadcasts": user_broadcasts,
        "count": len(user_broadcasts)
    }

@api_router.post("/broadcast/cancel/all")
async def cancel_all_broadcasts(current_user: dict = Depends(get_current_user)):
    """Cancel all active broadcasts for the current user"""
    user_id = current_user['id']
    cancelled = 0
    
    for broadcast_id, broadcast in active_broadcasts.items():
        if broadcast['user_id'] == user_id and broadcast['status'] == 'running':
            active_broadcasts[broadcast_id]['status'] = 'cancelled'
            logging.info(f"[DISPARO {broadcast_id}] 🛑 CANCELADO (cancel all)")
            cancelled += 1
    
    return {
        "message": f"{cancelled} disparo(s) cancelado(s)",
        "cancelled_count": cancelled
    }

@api_router.post("/broadcast/{broadcast_id}/cancel")
async def cancel_broadcast(broadcast_id: str, current_user: dict = Depends(get_current_user)):
    """Cancel an active broadcast"""
    if broadcast_id not in active_broadcasts:
        raise HTTPException(status_code=404, detail="Broadcast não encontrado")
    
    broadcast = active_broadcasts[broadcast_id]
    if broadcast['user_id'] != current_user['id']:
        raise HTTPException(status_code=403, detail="Acesso negado")
    
    active_broadcasts[broadcast_id]['status'] = 'cancelled'
    logging.info(f"[DISPARO {broadcast_id}] 🛑 CANCELADO pelo usuário")
    
    return {"message": "Disparo cancelado - aguarde as contas finalizarem"}

# ============== Extract Members Routes ==============

@api_router.post("/extract")
async def extract_members(group_username: str, current_user: dict = Depends(get_current_user)):
    # Check plan limits
    plan = current_user.get('plan', 'free')
    can_do, remaining, message = await check_limit(current_user['id'], plan, "extract_members")
    if not can_do:
        raise HTTPException(status_code=403, detail=message)
    
    account = await get_available_account(current_user['id'])
    if not account:
        raise HTTPException(status_code=400, detail="Nenhuma conta ativa disponível")
    
    if not account.get('session_string'):
        raise HTTPException(status_code=400, detail=f"Conta {account['phone']} não possui sessão válida. Faça login novamente.")
    
    phone = account['phone']
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    max_extract = limits['daily_extract_members']
    
    # Usa o novo sistema de lock seguro
    lock = await safe_acquire_lock(phone, timeout_seconds=30)
    if not lock:
        raise HTTPException(
            status_code=503, 
            detail="Sessão sendo preparada. Aguarde 5-10 minutos e tente novamente."
        )
    
    client = None
    try:
        creds = random.choice(DEFAULT_API_CREDENTIALS)
        client = await create_telegram_client(phone, creds['api_id'], creds['api_hash'])
        
        group = await client.get_entity(group_username)
        participants = await client.get_participants(group, limit=None)
        
        active_members = []
        current_time = datetime.now(timezone.utc)
        extracted_count = 0
        
        for user in participants:
            # Check if we hit the limit
            if extracted_count >= remaining:
                break
                
            if user.bot:
                continue
            
            is_active = False
            last_seen_str = "Desconhecido"
            
            if hasattr(user.status, '__class__'):
                if isinstance(user.status, UserStatusOnline):
                    is_active = True
                    last_seen_str = "Online"
                elif isinstance(user.status, UserStatusRecently):
                    is_active = True
                    last_seen_str = "Recentemente"
                elif hasattr(user.status, 'was_online'):
                    was_online = user.status.was_online
                    if was_online:
                        time_diff = current_time - was_online.replace(tzinfo=timezone.utc)
                        if time_diff.total_seconds() < 48 * 3600:
                            is_active = True
                            last_seen_str = f"{int(time_diff.total_seconds() / 3600)}h atrás"
            
            if is_active:
                member = Member(
                    user_id=current_user['id'],
                    user_telegram_id=user.id,
                    username=user.username,
                    first_name=user.first_name,
                    last_name=user.last_name,
                    phone=user.phone,
                    extracted_from=group_username,
                    last_seen=last_seen_str
                )
                active_members.append(member)
                extracted_count += 1
                
                doc = member.model_dump()
                doc['extracted_at'] = doc['extracted_at'].isoformat()
                await db.members.insert_one(doc)
        
        # Update usage
        await increment_usage(current_user['id'], "extract_members", extracted_count)
        
        await db.accounts.update_one(
            {"phone": phone},
            {"$set": {"last_used": datetime.now(timezone.utc).isoformat()}}
        )
        
        log = ActionLog(
            user_id=current_user['id'],
            action_type="extract",
            account_phone=phone,
            target=group_username,
            status="success",
            details=f"Extraídos {len(active_members)} membros ativos"
        )
        log_doc = log.model_dump()
        log_doc['created_at'] = log_doc['created_at'].isoformat()
        await db.action_logs.insert_one(log_doc)
        
        limit_msg = ""
        if plan != "premium" and extracted_count >= remaining:
            limit_msg = f" (Limite diário atingido: {max_extract})"
        
        return {
            "message": f"Extraídos {len(active_members)} membros ativos{limit_msg}",
            "count": len(active_members),
            "remaining": remaining - extracted_count
        }
    except Exception as e:
        error_msg = str(e)
        if "database is locked" in error_msg.lower():
            raise HTTPException(status_code=503, detail="Sessão sendo preparada. Aguarde 5-10 minutos e tente novamente.")
        raise HTTPException(status_code=400, detail=error_msg)
    finally:
        # Sempre desconecta o cliente e libera o lock
        if client:
            try:
                await client.disconnect()
            except:
                pass
        release_lock(phone, lock)

# ============== Members Routes ==============

@api_router.get("/members", response_model=List[Member])
async def get_members(current_user: dict = Depends(get_current_user)):
    members = await db.members.find({"user_id": current_user['id']}, {"_id": 0}).to_list(10000)
    for member in members:
        if isinstance(member.get('extracted_at'), str):
            member['extracted_at'] = datetime.fromisoformat(member['extracted_at'])
    return members

@api_router.delete("/members/{member_id}")
async def delete_member(member_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.members.delete_one({"id": member_id, "user_id": current_user['id']})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Membro não encontrado")
    return {"message": "Membro excluído"}

# ============== Send Messages Routes ==============

@api_router.post("/messages/send")
async def send_messages(request: MessageRequest, current_user: dict = Depends(get_current_user)):
    try:
        accounts = await db.accounts.find({
            "user_id": current_user['id'],
            "is_active": True,
            "session_string": {"$ne": None, "$exists": True}
        }, {"_id": 0}).to_list(100)
        if not accounts:
            raise HTTPException(status_code=400, detail="Nenhuma conta ativa com sessão válida")
        
        members = await db.members.find({
            "id": {"$in": request.member_ids},
            "user_id": current_user['id']
        }, {"_id": 0}).to_list(10000)
        if not members:
            raise HTTPException(status_code=400, detail="Nenhum membro encontrado")
        
        sent_count = 0
        account_index = 0
        
        for member in members:
            account = accounts[account_index % len(accounts)]
            account_index += 1
            phone = account['phone']
            lock = get_session_lock(phone)
            
            async with lock:
                client = None
                try:
                    creds = random.choice(DEFAULT_API_CREDENTIALS)
                    client = await create_telegram_client(phone, creds['api_id'], creds['api_hash'])
                    
                    if member.get('username'):
                        await client.send_message(member['username'], request.message)
                    else:
                        await client.send_message(member['user_telegram_id'], request.message)
                    
                    sent_count += 1
                    
                    delay = random.randint(request.delay_min, request.delay_max)
                    await asyncio.sleep(delay)
                    
                except FloodWaitError as e:
                    await asyncio.sleep(e.seconds)
                    continue
                except Exception as e:
                    print(f"Erro ao enviar para {member.get('username', member['user_telegram_id'])}: {str(e)}")
                    continue
                finally:
                    if client:
                        try:
                            await client.disconnect()
                        except:
                            pass
        
        log = ActionLog(
            user_id=current_user['id'],
            action_type="message",
            account_phone="multiple",
            target=f"{len(request.member_ids)} membros",
            status="success",
            details=f"Enviadas {sent_count}/{len(members)} mensagens"
        )
        log_doc = log.model_dump()
        log_doc['created_at'] = log_doc['created_at'].isoformat()
        await db.action_logs.insert_one(log_doc)
        
        return {"message": f"Mensagens enviadas: {sent_count}/{len(members)}"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ============== Add to Group Routes ==============

@api_router.post("/members/add-to-group")
async def add_to_group(request: AddToGroupRequest, current_user: dict = Depends(get_current_user)):
    try:
        # Check plan limits
        plan = current_user.get('plan', 'free')
        can_do, remaining, message = await check_limit(current_user['id'], plan, "add_to_group", len(request.member_ids))
        if not can_do:
            raise HTTPException(status_code=403, detail=message)
        
        # Limit members to remaining quota
        member_ids_to_process = request.member_ids[:remaining] if plan != "premium" else request.member_ids
        
        accounts = await db.accounts.find({
            "user_id": current_user['id'],
            "is_active": True,
            "session_string": {"$ne": None, "$exists": True}
        }, {"_id": 0}).to_list(100)
        if not accounts:
            raise HTTPException(status_code=400, detail="Nenhuma conta ativa com sessão válida")
        
        members = await db.members.find({
            "id": {"$in": member_ids_to_process},
            "user_id": current_user['id']
        }, {"_id": 0}).to_list(10000)
        if not members:
            raise HTTPException(status_code=400, detail="Nenhum membro encontrado")
        
        results = []
        added_count = 0
        failed_count = 0
        group_banned = False
        account_index = 0
        active_client = None
        current_account_phone = None
        
        for member in members:
            # Alterna entre contas a cada membro
            account = accounts[account_index % len(accounts)]
            account_phone = account['phone']
            account_index += 1
            
            member_name = member.get('username') or member.get('first_name') or str(member['user_telegram_id'])
            phone_display = account_phone[-4:] if len(account_phone) > 4 else account_phone
            
            try:
                # Fecha cliente anterior se mudou de conta
                if active_client and current_account_phone != account_phone:
                    try:
                        await active_client.disconnect()
                    except:
                        pass
                    active_client = None
                
                # Cria novo cliente se necessário
                if not active_client or current_account_phone != account_phone:
                    creds = random.choice(DEFAULT_API_CREDENTIALS)
                    active_client = await create_telegram_client(account_phone, creds['api_id'], creds['api_hash'])
                    current_account_phone = account_phone
                
                group = await active_client.get_entity(request.group_username)
                user = await active_client.get_entity(member['user_telegram_id'])
                
                # Usa método correto dependendo do tipo de grupo
                if isinstance(group, Channel):
                    await active_client(InviteToChannelRequest(
                        channel=group,
                        users=[user]
                    ))
                else:
                    await active_client(AddChatUserRequest(
                        chat_id=group.id,
                        user_id=user,
                        fwd_limit=0
                    ))
                
                added_count += 1
                results.append({
                    "member": member_name, 
                    "status": "success", 
                    "message": f"✅ Adicionado (conta ...{phone_display})",
                    "account": phone_display
                })
                
                # Delay entre adições
                delay = random.randint(request.delay_min, request.delay_max)
                await asyncio.sleep(delay)
                
            except FloodWaitError as e:
                results.append({
                    "member": member_name, 
                    "status": "flood", 
                    "message": f"⏳ FloodWait {e.seconds}s (conta ...{phone_display})",
                    "account": phone_display
                })
                failed_count += 1
                # Fecha cliente e espera um pouco antes de continuar
                if active_client:
                    try:
                        await active_client.disconnect()
                    except:
                        pass
                    active_client = None
                await asyncio.sleep(min(e.seconds, 10))
                # Continua para próximo membro com outra conta
                continue
                
            except UserPrivacyRestrictedError:
                results.append({
                    "member": member_name, 
                    "status": "failed", 
                    "message": f"❌ Privacidade restrita (conta ...{phone_display})",
                    "account": phone_display
                })
                failed_count += 1
                continue
                
            except UserNotMutualContactError:
                results.append({
                    "member": member_name, 
                    "status": "failed", 
                    "message": f"❌ Não é contato mútuo (conta ...{phone_display})",
                    "account": phone_display
                })
                failed_count += 1
                continue
                
            except UserBannedInChannelError:
                results.append({
                    "member": member_name, 
                    "status": "failed", 
                    "message": f"❌ Usuário banido (conta ...{phone_display})",
                    "account": phone_display
                })
                failed_count += 1
                continue
                
            except UserKickedError:
                results.append({
                    "member": member_name, 
                    "status": "failed", 
                    "message": f"❌ Usuário expulso (conta ...{phone_display})",
                    "account": phone_display
                })
                failed_count += 1
                continue
                
            except ChatAdminRequiredError:
                results.append({
                    "member": member_name, 
                    "status": "failed", 
                    "message": f"❌ Precisa ser admin (conta ...{phone_display})",
                    "account": phone_display
                })
                failed_count += 1
                # Não para, continua tentando com outras contas
                if active_client:
                    try:
                        await active_client.disconnect()
                    except:
                        pass
                    active_client = None
                continue
                
            except ChannelPrivateError:
                results.append({
                    "member": member_name, 
                    "status": "failed", 
                    "message": f"🚫 Grupo privado/banido (conta ...{phone_display})",
                    "account": phone_display
                })
                failed_count += 1
                group_banned = True
                # Tenta com outra conta antes de desistir
                if active_client:
                    try:
                        await active_client.disconnect()
                    except:
                        pass
                    active_client = None
                continue
                
            except ChatWriteForbiddenError:
                results.append({
                    "member": member_name, 
                    "status": "failed", 
                    "message": f"🚫 Sem permissão (conta ...{phone_display})",
                    "account": phone_display
                })
                failed_count += 1
                if active_client:
                    try:
                        await active_client.disconnect()
                    except:
                        pass
                    active_client = None
                continue
                
            except Exception as e:
                error_str = str(e).lower()
                error_msg = str(e)[:40]
                
                # Trata database locked - fecha cliente e continua
                if "database is locked" in error_str:
                    results.append({
                        "member": member_name, 
                        "status": "retry", 
                        "message": f"⚠️ Sessão sendo preparada, pulando (conta ...{phone_display})",
                        "account": phone_display
                    })
                    failed_count += 1
                    if active_client:
                        try:
                            await active_client.disconnect()
                        except:
                            pass
                        active_client = None
                    await asyncio.sleep(2)
                    continue
                
                if "banned" in error_str or "kicked" in error_str:
                    results.append({
                        "member": member_name, 
                        "status": "failed", 
                        "message": f"🚫 Banido (conta ...{phone_display})",
                        "account": phone_display
                    })
                    group_banned = True
                else:
                    results.append({
                        "member": member_name, 
                        "status": "failed", 
                        "message": f"❌ {error_msg} (conta ...{phone_display})",
                        "account": phone_display
                    })
                failed_count += 1
                
                # Fecha cliente em caso de erro
                if active_client:
                    try:
                        await active_client.disconnect()
                    except:
                        pass
                    active_client = None
                continue
        
        # Fecha último cliente
        if active_client:
            try:
                await active_client.disconnect()
            except:
                pass
        
        status_msg = "success" if added_count > 0 else "failed"
        if group_banned and added_count == 0:
            status_msg = "group_banned"
        
        log = ActionLog(
            user_id=current_user['id'],
            action_type="add_to_group",
            account_phone="multiple",
            target=request.group_username,
            status=status_msg,
            details=f"Adicionados {added_count}/{len(members)} membros"
        )
        log_doc = log.model_dump()
        log_doc['created_at'] = log_doc['created_at'].isoformat()
        await db.action_logs.insert_one(log_doc)
        
        # Update usage
        if added_count > 0:
            await increment_usage(current_user['id'], "add_to_group", added_count)
        
        return {
            "message": f"Membros adicionados: {added_count}/{len(members)}",
            "added": added_count,
            "failed": failed_count,
            "group_banned": group_banned,
            "results": results
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ============== Action Logs Routes ==============

@api_router.get("/logs", response_model=List[ActionLog])
async def get_logs(current_user: dict = Depends(get_current_user)):
    logs = await db.action_logs.find({"user_id": current_user['id']}, {"_id": 0}).sort("created_at", -1).to_list(100)
    for log in logs:
        if isinstance(log.get('created_at'), str):
            log['created_at'] = datetime.fromisoformat(log['created_at'])
    return logs

# ============== WebSocket for Broadcast Monitoring ==============

@app.websocket("/ws/broadcast/{user_id}")
async def websocket_broadcast(websocket: WebSocket, user_id: str):
    await websocket.accept()
    
    if user_id not in broadcast_connections:
        broadcast_connections[user_id] = []
    broadcast_connections[user_id].append(websocket)
    
    try:
        while True:
            # Keep connection alive
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        if user_id in broadcast_connections:
            broadcast_connections[user_id].remove(websocket)

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Create sessions directory
os.makedirs("sessions", exist_ok=True)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
    for c in active_clients.values():
        await c.disconnect()
