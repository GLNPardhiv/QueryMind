// src/context/ChatContext.jsx
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const ChatContext = createContext(null);

const DEFAULT_CONVERSATION = {
  id: 'default-thread',
  title: 'New Investigation',
  createdAt: new Date().toISOString(),
  messages: []
};

export function ChatProvider({ children }) {
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

  // User Role (ADMIN | STANDARD_USER) with persistence
  const [userRole, setUserRoleState] = useState(() => {
    try {
      const saved = localStorage.getItem('querymind_user_role');
      return saved ? saved : 'ADMIN';
    } catch (e) {
      return 'ADMIN';
    }
  });

  const setUserRole = (newRole) => {
    const normalized = newRole.toUpperCase() === 'ADMIN' ? 'ADMIN' : 'STANDARD_USER';
    setUserRoleState(normalized);
    try {
      localStorage.setItem('querymind_user_role', normalized);
    } catch (e) {
      console.warn("Could not save user role", e);
    }
  };

  // Active / Chosen Database State (null until chosen/connected)
  const [connectedDb, setConnectedDb] = useState(() => {
    try {
      const saved = localStorage.getItem('querymind_connected_db');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });

  useEffect(() => {
    if (connectedDb) {
      localStorage.setItem('querymind_connected_db', JSON.stringify(connectedDb));
    } else {
      localStorage.removeItem('querymind_connected_db');
    }
  }, [connectedDb]);

  // Conversations stored in localStorage + synced with MongoDB Atlas
  const [conversations, setConversations] = useState(() => {
    try {
      const saved = localStorage.getItem('querymind_conversations');
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

  // Persist conversations locally
  useEffect(() => {
    try {
      localStorage.setItem('querymind_conversations', JSON.stringify(conversations));
    } catch (e) {
      console.warn("Could not save conversations to storage", e);
    }
  }, [conversations]);

  // Sync with MongoDB backend
  const syncWithBackend = useCallback(async () => {
    try {
      const res = await axios.get('http://127.0.0.1:8000/api/v1/conversations');
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
  }, []);

  useEffect(() => {
    syncWithBackend();
  }, [syncWithBackend]);

  const activeChat = conversations.find(c => c.id === activeChatId) || conversations[0];

  const createNewChat = () => {
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

    // Persist to MongoDB
    axios.post('http://127.0.0.1:8000/api/v1/conversations', {
      id: newId,
      title: 'New Investigation'
    }).catch(() => {});
  };

  const renameChat = (chatId, newTitle) => {
    if (!newTitle || !newTitle.trim()) return;
    const trimmed = newTitle.trim();
    setConversations(prev => prev.map(conv => {
      if (conv.id === chatId) {
        return { ...conv, title: trimmed };
      }
      return conv;
    }));

    // Sync to MongoDB
    axios.put(`http://127.0.0.1:8000/api/v1/conversations/${chatId}`, {
      title: trimmed
    }).catch(() => {});
  };

  const deleteChat = (chatId, e) => {
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
      axios.post('http://127.0.0.1:8000/api/v1/conversations', {
        id: freshId,
        title: 'New Investigation'
      }).catch(() => {});
    } else {
      setConversations(remaining);
      if (activeChatId === chatId) {
        setActiveChatId(remaining[0].id);
      }
    }

    // Sync deletion to MongoDB
    axios.delete(`http://127.0.0.1:8000/api/v1/conversations/${chatId}`).catch(() => {});
  };

  const addMessageToActiveChat = (message, newTitle = null) => {
    setConversations(prev => prev.map(conv => {
      if (conv.id === activeChatId) {
        return {
          ...conv,
          title: newTitle || conv.title,
          messages: [...conv.messages, message]
        };
      }
      return conv;
    }));

    // If newTitle provided, sync title
    if (newTitle) {
      axios.put(`http://127.0.0.1:8000/api/v1/conversations/${activeChatId}`, {
        title: newTitle
      }).catch(() => {});
    }

    // Persist message to MongoDB
    axios.post(`http://127.0.0.1:8000/api/v1/conversations/${activeChatId}/messages`, message).catch(() => {});
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
