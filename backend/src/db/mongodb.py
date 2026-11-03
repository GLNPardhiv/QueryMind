# src/db/mongodb.py
import time
from typing import Optional, List, Dict, Any
from pymongo import MongoClient, DESCENDING

from src.core.config import config

class MongoService:
    def __init__(self):
        self.client: Optional[MongoClient] = None
        self.db = None
        self._init_strict_connection()

    def _init_strict_connection(self):
        """
        Strictly connects to MongoDB Atlas upon startup.
        If connection cannot be established or MONGO_URI is missing,
        server startup is aborted immediately with a fatal error.
        """
        uri = config.MONGO_URI
        if not uri or not uri.strip():
            raise RuntimeError(
                "FATAL: MONGO_URI is missing or empty in .env. "
                "QueryMind server strictly requires an active MongoDB connection to start. "
                "Please configure MONGO_URI in your .env file."
            )

        clean_uri = uri.strip()
        last_error = None

        # Attempt 1: Standard TLS connection
        try:
            client = MongoClient(clean_uri, serverSelectionTimeoutMS=5000)
            client.admin.command('ping')
            self.client = client
        except Exception as e:
            last_error = e
            # Attempt 2: Connection with TLS certificate tolerance (for clock/CA skew)
            try:
                client = MongoClient(clean_uri, tlsAllowInvalidCertificates=True, serverSelectionTimeoutMS=5000)
                client.admin.command('ping')
                self.client = client
            except Exception as e2:
                last_error = e2

        if not self.client:
            raise RuntimeError(
                f"FATAL: Failed to connect to MongoDB Atlas. Server startup aborted.\n"
                f"Connection string: {clean_uri.split('@')[-1] if '@' in clean_uri else 'hidden'}\n"
                f"Error: {str(last_error)}"
            )

        self.db = self.client[config.MONGO_DB_NAME]
        self._setup_indexes()
        print(f"[MongoDB STRICT] Successfully verified connection to MongoDB Atlas database: '{config.MONGO_DB_NAME}'")

    def _setup_indexes(self):
        try:
            self.db.conversations.create_index([("user_id", 1), ("updated_at", -1)])
            self.db.conversations.create_index([("id", 1), ("user_id", 1)], unique=True)
            self.db.messages.create_index([("conversation_id", 1), ("timestamp", 1)])
            self.db.users.create_index([("email", 1)], unique=True)
            self.db.users.create_index([("org_id", 1)])
            self.db.telemetry.create_index([("timestamp", -1)])
        except Exception as e:
            print(f"[MongoDB Indexes Notice] {e}")

    def is_connected(self) -> bool:
        try:
            self.client.admin.command('ping')
            return True
        except Exception:
            return False

    # ── Enterprise Multi-Tenant User & RBAC Management ──
    def get_or_create_user(self, user_id: str, email: str, requested_role: Optional[str] = None) -> Dict[str, Any]:
        """
        Enterprise RBAC Assignment:
        - Extracts the domain from the user's email.
        - First user from that domain becomes the 'ADMIN'.
        - Subsequent users registering from the same domain become 'STANDARD_USER'.
        - Persisted directly to MongoDB Atlas.
        """
        clean_email = email.lower().strip()
        domain = clean_email.split('@')[-1] if '@' in clean_email else 'default_org'

        # Public generic domains treated individually
        generic_domains = {"gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com"}
        org_id = f"user_{user_id[:8]}" if domain in generic_domains else domain.replace('.', '_')

        user = self.db.users.find_one({"$or": [{"user_id": user_id}, {"email": clean_email}]})
        if user:
            self.db.users.update_one({"_id": user["_id"]}, {"$set": {"last_seen": time.time()}})
            return {
                "user_id": user["user_id"],
                "email": user["email"],
                "org_id": user["org_id"],
                "role": user["role"]
            }

        # Check if this enterprise domain already has an admin
        existing_count = self.db.users.count_documents({"org_id": org_id})
        role = "ADMIN" if existing_count == 0 else "STANDARD_USER"

        if requested_role and requested_role.upper() in ["ADMIN", "STANDARD_USER"]:
            role = requested_role.upper()

        new_user = {
            "user_id": user_id,
            "email": clean_email,
            "domain": domain,
            "org_id": org_id,
            "role": role,
            "created_at": time.time(),
            "last_seen": time.time()
        }
        self.db.users.insert_one(new_user)
        return {
            "user_id": user_id,
            "email": clean_email,
            "org_id": org_id,
            "role": role
        }

    # ── Conversations Persistence ──
    def get_user_conversations(self, user_id: str) -> List[Dict[str, Any]]:
        cursor = self.db.conversations.find({"user_id": user_id}).sort("updated_at", DESCENDING)
        conversations = []
        for doc in cursor:
            conversations.append({
                "id": doc.get("id"),
                "title": doc.get("title", "New Investigation"),
                "createdAt": doc.get("created_at"),
                "updatedAt": doc.get("updated_at")
            })
        return conversations

    def save_conversation(self, user_id: str, org_id: str, conv_id: str, title: str) -> Dict[str, Any]:
        now = time.time()
        conv_data = {
            "id": conv_id,
            "user_id": user_id,
            "org_id": org_id,
            "title": title,
            "created_at": now,
            "updated_at": now
        }
        self.db.conversations.update_one(
            {"id": conv_id, "user_id": user_id},
            {"$set": conv_data},
            upsert=True
        )
        return conv_data

    def rename_conversation(self, user_id: str, conv_id: str, new_title: str) -> bool:
        res = self.db.conversations.update_one(
            {"id": conv_id, "user_id": user_id},
            {"$set": {"title": new_title, "updated_at": time.time()}}
        )
        return res.matched_count > 0

    def delete_conversation(self, user_id: str, conv_id: str) -> bool:
        self.db.conversations.delete_one({"id": conv_id, "user_id": user_id})
        self.db.messages.delete_many({"conversation_id": conv_id, "user_id": user_id})
        return True

    # ── Messages Persistence ──
    def get_conversation_messages(self, user_id: str, conv_id: str) -> List[Dict[str, Any]]:
        cursor = self.db.messages.find({"conversation_id": conv_id, "user_id": user_id}).sort("timestamp", 1)
        messages = []
        for doc in cursor:
            messages.append({
                "id": doc.get("id"),
                "sender": doc.get("sender"),
                "text": doc.get("text"),
                "sql": doc.get("sql"),
                "status": doc.get("status"),
                "execution": doc.get("execution"),
                "tablesUsed": doc.get("tables_used", []),
                "latencyMs": doc.get("latency_ms"),
                "isFollowUp": doc.get("is_followup", False),
                "fileAttachment": doc.get("file_attachment"),
                "timestamp": doc.get("time_str", "")
            })
        return messages

    def add_message(self, user_id: str, org_id: str, conv_id: str, message: Dict[str, Any]) -> Dict[str, Any]:
        doc = {
            "id": message.get("id", f"msg-{int(time.time()*1000)}"),
            "conversation_id": conv_id,
            "user_id": user_id,
            "org_id": org_id,
            "sender": message.get("sender", "user"),
            "text": message.get("text", ""),
            "sql": message.get("sql"),
            "status": message.get("status", "success"),
            "execution": message.get("execution"),
            "tables_used": message.get("tablesUsed", []),
            "latency_ms": message.get("latencyMs"),
            "is_followup": message.get("isFollowUp", False),
            "file_attachment": message.get("fileAttachment"),
            "time_str": message.get("timestamp", ""),
            "timestamp": time.time()
        }
        self.db.messages.insert_one(doc)
        self.db.conversations.update_one(
            {"id": conv_id, "user_id": user_id},
            {"$set": {"updated_at": time.time()}},
            upsert=True
        )
        return message

    # ── Telemetry Audit Persistence ──
    def log_telemetry(self, audit_data: Dict[str, Any]):
        try:
            doc = dict(audit_data)
            # Remove any raw _id so MongoDB creates its own without mutating audit_data
            doc.pop("_id", None)
            self.db.telemetry.insert_one(doc)
        except Exception as e:
            print(f"[MongoDB Telemetry Log Error] {e}")

    def get_recent_telemetry(self, org_id: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        try:
            query = {"org_id": org_id} if org_id else {}
            cursor = self.db.telemetry.find(query).sort("timestamp", DESCENDING).limit(limit)
            items = []
            for doc in cursor:
                doc["_id"] = str(doc.get("_id"))
                items.append(doc)
            return items
        except Exception as e:
            print(f"[MongoDB Telemetry Fetch Error] {e}")
            return []

    def delete_telemetry_item(self, item_id: str) -> bool:
        try:
            from bson import ObjectId
            queries = [{"id": item_id}]
            if len(item_id) == 24:
                try:
                    queries.append({"_id": ObjectId(item_id)})
                except Exception:
                    pass
            res = self.db.telemetry.delete_one({"$or": queries})
            return res.deleted_count > 0
        except Exception as e:
            print(f"[MongoDB Delete Telemetry Error] {e}")
            return False

    def clear_telemetry(self, org_id: Optional[str] = None) -> bool:
        try:
            query = {"org_id": org_id} if org_id else {}
            self.db.telemetry.delete_many(query)
            return True
        except Exception as e:
            print(f"[MongoDB Clear Telemetry Error] {e}")
            return False

mongo_service = MongoService()
