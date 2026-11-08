// src/context/ChatContext.jsx
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useAuth, useUser } from '@clerk/clerk-react';

const ChatContext = createContext(null);

const DEFAULT_CONVERSATION = {
  id: 'default-thread',
  title: 'New Investigation',
  createdAt: new Date().toISOString(),
  messages: []
};

export function ChatProvider({ children }) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const currentUserId = user?.id || 'guest';

  // Single Gemini-style sidebar: opens and closes only when clicked
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('querymind_sidebar_open');
    return saved !== null ? JSON.parse(saved) : true;
  });

  const toggleSidebar = () => {
    setIsSidebarOpen(prev => {
      const next = !prev;
      localStorage.setItem('querymind_sidebar_open', JSON.stringify(next));
      return next;
    });
  };

  // Global Connect DB Modal State
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);

  // Global Role Verification Modal State
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);

  // MongoDB Atlas Connectivity State
  const [mongoConnected, setMongoConnected] = useState(false);

  // User Role (ADMIN | STANDARD_USER) with per-user persistence
  const [userRole, setUserRoleState] = useState(() => {
    try {
      const roleKey = `querymind_user_role_${currentUserId}`;
      const saved = localStorage.getItem(roleKey);
      return saved ? saved : 'ADMIN';
    } catch (e) {
      return 'ADMIN';
    }
  });

  const setUserRole = (newRole) => {
    const normalized = newRole.toUpperCase() === 'ADMIN' ? 'ADMIN' : 'STANDARD_USER';
    setUserRoleState(normalized);
    try {
      localStorage.setItem(`querymind_user_role_${currentUserId}`, normalized);
    } catch (e) {
      console.warn("Could not save user role", e);
    }
  };

  // Active / Chosen Database State (null until chosen/connected, per-user isolated)
  const [connectedDb, setConnectedDb] = useState(() => {
    try {
      const dbKey = `querymind_connected_db_${currentUserId}`;
      const saved = localStorage.getItem(dbKey);
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });

  // Helper to generate auth headers with current token & user context
  const getAuthHeaders = useCallback(async () => {
    try {
      const token = await getToken();
      return {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-User-Id': user?.id || '',
        'X-User-Email': user?.primaryEmailAddress?.emailAddress || '',
        'X-User-Role': userRole
      };
    } catch {
      return {
        'X-User-Id': user?.id || '',
        'X-User-Email': user?.primaryEmailAddress?.emailAddress || '',
        'X-User-Role': userRole
      };
    }
  }, [getToken, user, userRole]);

  // Conversations stored in localStorage partitioned strictly by user ID
  const [conversations, setConversations] = useState(() => {
    try {
      const convKey = `querymind_conversations_${currentUserId}`;
      const saved = localStorage.getItem(convKey);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn("Could not read conversations from storage", e);
    }
    return [DEFAULT_CONVERSATION];
  });

  const [activeChatId, setActiveChatId] = useState(() => {
    return conversations[0]?.id || 'default-thread';
  });

  // Active SQL query to be opened in Workbench
  const [activeWorkbenchSql, setActiveWorkbenchSql] = useState(
    '-- Write or inspect SQL here\nSELECT CustomerID, AccountNumber, TerritoryID FROM customer LIMIT 5;'
  );

  // Active workbench view mode ('chat' | 'workbench')
  const [workbenchMode, setWorkbenchMode] = useState('chat');

  // Switch context cleanly whenever the active user logs in, out, or changes
  const prevUserIdRef = useRef(currentUserId);
  useEffect(() => {
    if (prevUserIdRef.current !== currentUserId) {
      prevUserIdRef.current = currentUserId;

      // 1. Reload conversations for this user
      const convKey = `querymind_conversations_${currentUserId}`;
      try {
        const savedConv = localStorage.getItem(convKey);
        if (savedConv) {
          const parsed = JSON.parse(savedConv);
          setConversations(parsed);
          setActiveChatId(parsed[0]?.id || 'default-thread');
        } else {
          const fresh = [{
            id: `chat-${Date.now()}`,
            title: 'New Investigation',
            createdAt: new Date().toISOString(),
            messages: []
          }];
          setConversations(fresh);
          setActiveChatId(fresh[0].id);
        }
      } catch {
        setConversations([DEFAULT_CONVERSATION]);
        setActiveChatId(DEFAULT_CONVERSATION.id);
      }

      // 2. Reload connected DB for this user
      const dbKey = `querymind_connected_db_${currentUserId}`;
      try {
        const savedDb = localStorage.getItem(dbKey);
        setConnectedDb(savedDb ? JSON.parse(savedDb) : null);
      } catch {
        setConnectedDb(null);
      }

      // 3. Reload role for this user
      const roleKey = `querymind_user_role_${currentUserId}`;
      try {
        const savedRole = localStorage.getItem(roleKey);
        setUserRoleState(savedRole || 'ADMIN');
      } catch {
        setUserRoleState('ADMIN');
      }
    }
  }, [currentUserId]);

  // Persist conversations per-user
  useEffect(() => {
    const convKey = `querymind_conversations_${currentUserId}`;
    try {
      localStorage.setItem(convKey, JSON.stringify(conversations));
    } catch (e) {
      console.warn("Could not save conversations to storage", e);
    }
  }, [conversations, currentUserId]);

  // Persist connected DB per-user
  useEffect(() => {
    const dbKey = `querymind_connected_db_${currentUserId}`;
    if (connectedDb) {
      localStorage.setItem(dbKey, JSON.stringify(connectedDb));
    } else {
      localStorage.removeItem(dbKey);
    }
  }, [connectedDb, currentUserId]);

  // Sync with MongoDB backend strictly for the authenticated user
  const syncWithBackend = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await axios.get('http://127.0.0.1:8000/api/v1/conversations', { headers });
      if (res.data?.mongo_connected !== undefined) {
        setMongoConnected(res.data.mongo_connected);
      }
      if (res.data?.conversations && res.data.conversations.length > 0) {
        setConversations(prev => {
          const remoteList = res.data.conversations;
          return remoteList.map(rc => {
            const local = prev.find(p => p.id === rc.id);
            return {
              id: rc.id,
              title: rc.title || 'New Investigation',
              createdAt: rc.createdAt || new Date().toISOString(),
              messages: local?.messages || []
            };
          });
        });
      }
    } catch (e) {
      // Silent fallback
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (user?.id) {
      syncWithBackend();
    }
  }, [user?.id, syncWithBackend]);

  // Lazy load conversation messages if needed
  const loadMessagesForChat = useCallback(async (chatId) => {
    if (!chatId) return;
    try {
      const headers = await getAuthHeaders();
      const res = await axios.get(`http://127.0.0.1:8000/api/v1/conversations/${chatId}/messages`, { headers });
      if (res.data?.messages && res.data.messages.length > 0) {
        setConversations(prev => prev.map(conv => {
          if (conv.id === chatId && (!conv.messages || conv.messages.length === 0)) {
            return { ...conv, messages: res.data.messages };
          }
          return conv;
        }));
      }
    } catch (e) {
      console.warn("Could not load messages from server", e);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    const targetChat = conversations.find(c => c.id === activeChatId);
    if (targetChat && (!targetChat.messages || targetChat.messages.length === 0)) {
      loadMessagesForChat(activeChatId);
    }
  }, [activeChatId, loadMessagesForChat]);

  const activeChat = conversations.find(c => c.id === activeChatId) || conversations[0];

  const createNewChat = async () => {
    const newId = `chat-${Date.now()}`;
    const newConv = {
      id: newId,
      title: 'New Investigation',
      createdAt: new Date().toISOString(),
      messages: []
    };
    setConversations([newConv, ...conversations]);
    setActiveChatId(newId);
    setWorkbenchMode('chat');

    // Persist to MongoDB with auth headers
    try {
      const headers = await getAuthHeaders();
      axios.post('http://127.0.0.1:8000/api/v1/conversations', {
        id: newId,
        title: 'New Investigation'
      }, { headers }).catch(() => {});
    } catch {}
  };

  const renameChat = async (chatId, newTitle) => {
    if (!newTitle || !newTitle.trim()) return;
    const trimmed = newTitle.trim();
    setConversations(prev => prev.map(conv => {
      if (conv.id === chatId) {
        return { ...conv, title: trimmed };
      }
      return conv;
    }));

    // Sync to MongoDB with auth headers
    try {
      const headers = await getAuthHeaders();
      axios.put(`http://127.0.0.1:8000/api/v1/conversations/${chatId}`, {
        title: trimmed
      }, { headers }).catch(() => {});
    } catch {}
  };

  const deleteChat = async (chatId, e) => {
    if (e) e.stopPropagation();
    const remaining = conversations.filter(c => c.id !== chatId);
    if (remaining.length === 0) {
      const freshId = `chat-${Date.now()}`;
      const fresh = [{
        id: freshId,
        title: 'New Investigation',
        createdAt: new Date().toISOString(),
        messages: []
      }];
      setConversations(fresh);
      setActiveChatId(fresh[0].id);
      try {
        const headers = await getAuthHeaders();
        axios.post('http://127.0.0.1:8000/api/v1/conversations', {
          id: freshId,
          title: 'New Investigation'
        }, { headers }).catch(() => {});
      } catch {}
    } else {
      setConversations(remaining);
      if (activeChatId === chatId) {
        setActiveChatId(remaining[0].id);
      }
    }

    // Sync deletion to MongoDB with auth headers
    try {
      const headers = await getAuthHeaders();
      axios.delete(`http://127.0.0.1:8000/api/v1/conversations/${chatId}`, { headers }).catch(() => {});
    } catch {}
  };

  const addMessageToActiveChat = async (message, newTitle = null) => {
    setConversations(prev => prev.map(conv => {
      if (conv.id === activeChatId) {
        return {
          ...conv,
          title: newTitle || conv.title,
          messages: [...(conv.messages || []), message]
        };
      }
      return conv;
    }));

    try {
      const headers = await getAuthHeaders();
      // If newTitle provided, sync title
      if (newTitle) {
        axios.put(`http://127.0.0.1:8000/api/v1/conversations/${activeChatId}`, {
          title: newTitle
        }, { headers }).catch(() => {});
      }

      // Persist message to MongoDB with auth headers
      axios.post(`http://127.0.0.1:8000/api/v1/conversations/${activeChatId}/messages`, message, { headers }).catch(() => {});
    } catch {}
  };

  const openInWorkbench = (sql) => {
    if (sql) setActiveWorkbenchSql(sql);
    setWorkbenchMode('workbench');
  };

  return (
    <ChatContext.Provider
      value={{
        isSidebarOpen,
        toggleSidebar,
        isConnectModalOpen,
        setIsConnectModalOpen,
        isRoleModalOpen,
        setIsRoleModalOpen,
        mongoConnected,
        userRole,
        setUserRole,
        isAdmin: userRole === 'ADMIN',
        connectedDb,
        setConnectedDb,
        conversations,
        activeChatId,
        setActiveChatId,
        activeChat,
        createNewChat,
        renameChat,
        deleteChat,
        addMessageToActiveChat,
        activeWorkbenchSql,
        setActiveWorkbenchSql,
        workbenchMode,
        setWorkbenchMode,
        openInWorkbench,
        syncWithBackend
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
