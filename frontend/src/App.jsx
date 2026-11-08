// src/App.jsx
import React, { useState } from 'react';
import axios from 'axios';
import { BrowserRouter, Routes, Route, Link, useLocation, Navigate, useNavigate } from 'react-router-dom';
import { ClerkProvider, SignedIn, SignedOut, UserButton, useUser, useAuth } from '@clerk/clerk-react';
import { 
  Database, Network, MessageSquare, Terminal, Activity,
  X, Plug, Plus, Trash2, PanelLeftClose, ShieldCheck, Lock,
  KeyRound, Check, AlertCircle, UserCheck, ShieldAlert, Pencil
} from 'lucide-react';

import { ChatProvider, useChat } from './context/ChatContext';
import QueryWorkbench from './pages/QueryWorkbench';
import SchemaExplorer from './pages/SchemaExplorer';
import Telemetry from './pages/Telemetry';
import LandingPage from './pages/LandingPage';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!PUBLISHABLE_KEY) {
  console.error("Missing Clerk Publishable Key! Check your .env file.");
}

// Connect Database Modal (Admin-only capability)
const ConnectDbModal = ({ isOpen, onClose, onConnect, userRole, isConnecting, connectError }) => {
  const [uri, setUri] = useState('');
  const [alias, setAlias] = useState('');
  
  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (userRole !== 'ADMIN') {
      alert("Permission Denied: Only verified ADMIN users can register external database URIs.");
      return;
    }
    onConnect(uri, alias);
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-[#0e0e11] border border-white/[0.12] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.08] flex justify-between items-center bg-[#070709]">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Plug className="w-4 h-4 text-white" />
            Connect Database URI
          </h3>
          <button onClick={onClose} disabled={isConnecting} className="text-neutral-400 hover:text-white transition-colors cursor-pointer p-1 rounded-lg hover:bg-white/[0.06]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {userRole !== 'ADMIN' && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-200 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-amber-300">Admin Privilege Required:</span>
                <p className="mt-0.5 text-neutral-400">Your role ({userRole}) cannot connect external URIs. Verify Admin role to unlock.</p>
              </div>
            </div>
          )}

          {connectError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-rose-300">Connection Failed:</span>
                <p className="mt-0.5 text-neutral-400">{connectError}</p>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1.5">Connection Alias</label>
            <input 
              type="text" required placeholder="e.g., AdventureWorks Production" 
              value={alias} onChange={e => setAlias(e.target.value)}
              disabled={userRole !== 'ADMIN' || isConnecting}
              className="w-full bg-[#000000] border border-white/[0.12] text-white rounded-xl px-3.5 py-2.5 text-xs focus:border-white focus:ring-1 focus:ring-white outline-none transition-all placeholder-neutral-600 disabled:opacity-40"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1.5">Database URI String</label>
            <input 
              type="password" required placeholder="mysql+pymysql://user:pass@host:3306/db" 
              value={uri} onChange={e => setUri(e.target.value)}
              disabled={userRole !== 'ADMIN' || isConnecting}
              className="w-full bg-[#000000] border border-white/[0.12] text-white rounded-xl px-3.5 py-2.5 text-xs focus:border-white focus:ring-1 focus:ring-white outline-none font-mono transition-all placeholder-neutral-600 disabled:opacity-40"
            />
          </div>
          <div className="text-[11px] text-neutral-400 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-neutral-300" />
            <span>Live engine extraction inspects all tables, columns, and foreign keys.</span>
          </div>
          <button 
            type="submit" 
            disabled={userRole !== 'ADMIN' || isConnecting}
            className="w-full bg-white hover:bg-neutral-200 disabled:opacity-40 text-black font-semibold py-2.5 rounded-xl mt-2 transition-all cursor-pointer text-xs flex items-center justify-center gap-2"
          >
            {isConnecting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            <span>{isConnecting ? 'Extracting Schema & Connecting...' : 'Extract Schema & Connect'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};

// Role Verification & Management Modal (Admin vs User)
const RoleVerificationModal = ({ isOpen, onClose, currentRole, onUpdateRole }) => {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (!isOpen) return null;

  const handleVerifyAdmin = (e) => {
    e.preventDefault();
    setError('');
    // Check admin passcode (default demo: admin123 or admin)
    if (passcode.trim() === 'admin123' || passcode.trim().toLowerCase() === 'admin') {
      onUpdateRole('ADMIN');
      setSuccess('Admin credentials verified successfully!');
      setTimeout(() => {
        setSuccess('');
        setPasscode('');
        onClose();
      }, 700);
    } else {
      setError('Invalid admin key. Enter "admin123" for demo verification.');
    }
  };

  const handleDemoteToUser = () => {
    onUpdateRole('STANDARD_USER');
    setSuccess('Switched to STANDARD_USER role.');
    setTimeout(() => {
      setSuccess('');
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-[#0e0e11] border border-white/[0.12] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.08] flex justify-between items-center bg-[#070709]">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-white" />
            User Role & RBAC Verification
          </h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-white transition-colors cursor-pointer p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs">
          {/* Current Status Pill */}
          <div className="p-3.5 bg-[#000000] border border-white/[0.08] rounded-xl flex items-center justify-between">
            <div>
              <span className="text-neutral-400 block text-[11px]">Active Session Role</span>
              <span className="font-mono font-bold text-white text-sm">{currentRole}</span>
            </div>
            <span className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-semibold border ${
              currentRole === 'ADMIN'
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-neutral-800 text-neutral-300 border-white/10'
            }`}>
              {currentRole === 'ADMIN' ? 'Full Authority' : 'Restricted Query Access'}
            </span>
          </div>

          {/* Permissions Matrix */}
          <div className="space-y-2 border-t border-white/[0.08] pt-4">
            <div className="text-neutral-400 font-semibold uppercase text-[10px] tracking-wider mb-2">
              Role Permissions Matrix:
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="p-2 rounded-lg bg-[#000000] border border-white/[0.06]">
                <span className="text-white font-medium block">ADMIN</span>
                <span className="text-neutral-400 block mt-1">• Connect Database URIs</span>
                <span className="text-neutral-400 block">• Query all 70 tables</span>
                <span className="text-neutral-400 block">• Inspect salaries & logs</span>
              </div>
              <div className="p-2 rounded-lg bg-[#000000] border border-white/[0.06]">
                <span className="text-white font-medium block">STANDARD_USER</span>
                <span className="text-neutral-400 block mt-1">• Read-only approved DBs</span>
                <span className="text-neutral-400 block">• AST blocks sensitive tables</span>
                <span className="text-neutral-400 block">• Cannot add new URIs</span>
              </div>
            </div>
          </div>

          {/* Verification Form */}
          {currentRole !== 'ADMIN' ? (
            <form onSubmit={handleVerifyAdmin} className="space-y-3 pt-2">
              <label className="block text-neutral-300 font-medium">Verify Admin Passcode:</label>
              <div className="relative">
                <input 
                  type="password" 
                  placeholder="Enter admin passcode (e.g., admin123)"
                  value={passcode} 
                  onChange={(e) => setPasscode(e.target.value)}
                  className="w-full bg-[#000000] border border-white/[0.14] text-white rounded-xl px-3.5 py-2.5 text-xs focus:border-white focus:ring-1 focus:ring-white outline-none font-mono"
                />
              </div>
              {error && <p className="text-rose-400 text-[11px]">{error}</p>}
              {success && <p className="text-emerald-400 text-[11px]">{success}</p>}
              <button 
                type="submit"
                className="w-full bg-white hover:bg-neutral-200 text-black font-semibold py-2.5 rounded-xl transition-all cursor-pointer text-xs"
              >
                Verify & Promote to ADMIN
              </button>
            </form>
          ) : (
            <div className="pt-2 space-y-2">
              {success && <p className="text-emerald-400 text-[11px] mb-2">{success}</p>}
              <button 
                onClick={handleDemoteToUser}
                className="w-full bg-[#18181b] hover:bg-[#222226] text-neutral-300 hover:text-white border border-white/10 font-medium py-2.5 rounded-xl transition-all cursor-pointer text-xs"
              >
                Switch to STANDARD_USER (Test Restricted Mode)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Nav items: Schema Graph at top, followed by Chat Copilot, SQL Workbench, Telemetry
const NAV_ITEMS = [
  { id: 'schema',    icon: Network,       label: 'Schema Graph',  path: '/app/schema',     mode: null },
  { id: 'chat',      icon: MessageSquare, label: 'Chat Copilot',  path: '/app',            mode: 'chat' },
  { id: 'workbench', icon: Terminal,      label: 'SQL Workbench', path: '/app',            mode: 'workbench' },
  { id: 'telemetry', icon: Activity,      label: 'Telemetry',     path: '/app/telemetry',  mode: null },
];

const DashboardLayout = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useUser();
  const { 
    isSidebarOpen, toggleSidebar, isConnectModalOpen, setIsConnectModalOpen,
    isRoleModalOpen, setIsRoleModalOpen, userRole, setUserRole, isAdmin,
    connectedDb, setConnectedDb,
    conversations, activeChatId, setActiveChatId, createNewChat, renameChat, deleteChat, 
    workbenchMode, setWorkbenchMode
  } = useChat();

  const { getToken } = useAuth();
  const [editingChatId, setEditingChatId] = useState(null);
  const [editingTitleText, setEditingTitleText] = useState('');
  const [isConnectingDb, setIsConnectingDb] = useState(false);
  const [connectDbError, setConnectDbError] = useState('');

  const handleConnectDb = async (uri, alias) => {
    setIsConnectingDb(true);
    setConnectDbError('');
    try {
      const token = await getToken();
      const res = await axios.post('http://127.0.0.1:8000/api/v1/connect-db',
        { uri, alias },
        { 
          headers: { 
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'X-User-Id': user?.id || '',
            'X-User-Email': user?.primaryEmailAddress?.emailAddress || '',
            'X-User-Role': userRole 
          } 
        }
      );

      setConnectedDb({
        id: alias.toLowerCase().replace(/\s+/g, '_'),
        name: alias,
        uri,
        tableCount: res.data.table_count,
        schema: res.data.schema
      });
      setIsConnectModalOpen(false);
      window.dispatchEvent(new CustomEvent('schema-updated', { detail: res.data.schema }));
    } catch (err) {
      setConnectDbError(err.response?.data?.detail || err.message || 'Error connecting to database');
    } finally {
      setIsConnectingDb(false);
    }
  };

  const isNavActive = (item) => {
    if (item.mode) return location.pathname === item.path && workbenchMode === item.mode;
    return location.pathname.startsWith(item.path);
  };

  return (
    <div className="flex h-screen bg-[#000000] text-white font-sans overflow-hidden">
      
      {/* ── Google Gemini Deep Black Sidebar ── */}
      <aside
        className={`
          bg-[#09090b] border-r border-white/[0.08] flex flex-col z-30 shrink-0
          transition-all duration-300 ease-in-out relative
          ${isSidebarOpen ? 'w-68' : 'w-[64px]'}
        `}
      >
        {/* Top Header: Logo opens sidebar when clicked; collapse icon visible only when sidebar is open */}
        <div className="h-14 px-3.5 border-b border-white/[0.08] flex items-center justify-between shrink-0 bg-[#09090b]">
          <div 
            onClick={() => {
              if (!isSidebarOpen) toggleSidebar();
            }}
            className={`flex items-center gap-3 overflow-hidden ${
              !isSidebarOpen ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''
            }`}
            title={!isSidebarOpen ? "Click logo to open sidebar" : undefined}
          >
            <div className="w-8 h-8 rounded-xl bg-white text-black flex items-center justify-center font-bold shrink-0">
              <Database className="w-4 h-4" />
            </div>
            {isSidebarOpen && (
              <span className="font-semibold text-sm tracking-tight text-white whitespace-nowrap transition-opacity duration-200">
                QueryMind
              </span>
            )}
          </div>

          {/* Sidebar collapse icon: visible only when sidebar is opened */}
          {isSidebarOpen && (
            <button
              onClick={toggleSidebar}
              className="p-1.5 text-neutral-400 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer shrink-0"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Gemini-Style "+ New chat" Button */}
        <div className="p-2.5 shrink-0">
          <button
            onClick={() => {
              createNewChat();
              if (location.pathname !== '/app') navigate('/app');
            }}
            title="New Chat"
            className={`
              flex items-center gap-3 w-full bg-[#141417] hover:bg-[#1c1c20] text-white
              rounded-xl text-xs font-medium transition-all border border-white/[0.08] hover:border-white/[0.2] cursor-pointer group
              ${isSidebarOpen ? 'px-3.5 py-2.5' : 'h-10 justify-center px-0'}
            `}
          >
            <div className="w-5 h-5 rounded-lg bg-white/[0.08] text-white flex items-center justify-center group-hover:bg-white group-hover:text-black transition-colors shrink-0">
              <Plus className="w-3.5 h-3.5" />
            </div>
            {isSidebarOpen && (
              <span className="whitespace-nowrap font-medium transition-opacity duration-200">
                New chat
              </span>
            )}
          </button>
        </div>

        {/* Navigation Links */}
        <div className="px-2 py-1 space-y-1 shrink-0">
          {NAV_ITEMS.map(item => {
            const active = isNavActive(item);
            const Icon = item.icon;
            return (
              <Link
                key={item.id}
                to={item.path}
                onClick={() => { if (item.mode) setWorkbenchMode(item.mode); }}
                title={item.label}
                className={`
                  flex items-center gap-3 rounded-xl text-xs font-medium transition-all
                  ${isSidebarOpen ? 'px-3 py-2.5' : 'h-10 justify-center px-0'}
                  ${active
                    ? 'bg-white/[0.12] text-white border border-white/[0.16]'
                    : 'text-neutral-400 hover:text-white hover:bg-white/[0.04] border border-transparent'}
                `}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-white' : 'text-neutral-500'}`} />
                {isSidebarOpen && (
                  <span className="whitespace-nowrap transition-opacity duration-200">
                    {item.label}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        {/* Recent Conversations List */}
        {isSidebarOpen ? (
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5 border-t border-white/[0.08] mt-2">
            <div className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider px-2 py-1">
              Recent
            </div>
            {conversations.map(chat => {
              const isActive = location.pathname === '/app' && workbenchMode === 'chat' && chat.id === activeChatId;
              const isEditing = editingChatId === chat.id;

              if (isEditing) {
                return (
                  <form
                    key={chat.id}
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (editingTitleText.trim()) {
                        renameChat(chat.id, editingTitleText.trim());
                      }
                      setEditingChatId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1.5 px-2 py-1.5 bg-[#141418] border border-white/20 rounded-xl w-full"
                  >
                    <input
                      type="text"
                      autoFocus
                      value={editingTitleText}
                      onChange={(e) => setEditingTitleText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditingChatId(null);
                      }}
                      className="w-full bg-transparent text-xs text-white outline-none font-medium px-1"
                    />
                    <button
                      type="submit"
                      className="p-1 hover:text-white text-emerald-400 cursor-pointer"
                      title="Save name"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingChatId(null)}
                      className="p-1 text-neutral-400 hover:text-white cursor-pointer"
                      title="Cancel"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </form>
                );
              }

              return (
                <div
                  key={chat.id}
                  onClick={() => {
                    setActiveChatId(chat.id);
                    setWorkbenchMode('chat');
                    if (location.pathname !== '/app') navigate('/app');
                  }}
                  className={`group flex items-center justify-between px-2.5 py-2 rounded-xl text-xs cursor-pointer transition-all ${
                    isActive 
                      ? 'bg-white/[0.08] text-white font-medium' 
                      : 'text-neutral-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate min-w-0 flex-1 mr-1">
                    <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-white' : 'text-neutral-500'}`} />
                    <span className="truncate">{chat.title}</span>
                  </div>

                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingChatId(chat.id);
                        setEditingTitleText(chat.title);
                      }}
                      className="text-neutral-400 hover:text-white p-1 rounded hover:bg-white/[0.08] transition-colors cursor-pointer"
                      title="Edit chat name"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => deleteChat(chat.id, e)}
                      className="text-neutral-400 hover:text-rose-400 p-1 rounded hover:bg-white/[0.08] transition-colors cursor-pointer"
                      title="Delete chat"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex-1" />
        )}

        {/* Database & Profile Footer with Role Badge */}
        <div className="p-2.5 border-t border-white/[0.08] bg-[#070709] shrink-0 space-y-2">
          {isSidebarOpen ? (
            <div className="flex items-center justify-between text-[11px] text-neutral-400 font-mono px-1">
              <span className="flex items-center gap-1.5 text-white">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Live DB
              </span>
              <span className="bg-white/[0.06] px-2 py-0.5 rounded-md text-[10px] text-neutral-300">70 Tables</span>
            </div>
          ) : (
            <div className="flex justify-center py-1" title="Connected: 70 Live Tables">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
            </div>
          )}

          <div className={`flex items-center gap-2 ${isSidebarOpen ? 'px-1' : 'justify-center'}`}>
            <UserButton afterSignOutUrl="/" appearance={{ elements: { avatarBox: "w-7 h-7 rounded-full" } }} />
            {isSidebarOpen && (
              <div className="min-w-0 flex-1 flex items-center justify-between">
                <div className="truncate mr-1">
                  <div className="text-xs text-white truncate font-medium">
                    {user?.fullName || user?.primaryEmailAddress?.emailAddress}
                  </div>
                  <div className="text-[10px] text-neutral-500 font-mono truncate">Verified Auth</div>
                </div>

                {/* Clickable Role Switcher & Verification Pill */}
                <button
                  onClick={() => setIsRoleModalOpen(true)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border transition-all cursor-pointer flex items-center gap-1 shrink-0 ${
                    isAdmin
                      ? 'bg-white/[0.08] text-white border-white/20 hover:bg-white/[0.15]'
                      : 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                  }`}
                  title="Click to verify or switch RBAC role"
                >
                  {isAdmin ? <ShieldCheck className="w-2.5 h-2.5 text-white" /> : <Lock className="w-2.5 h-2.5 text-amber-300" />}
                  <span>{userRole === 'ADMIN' ? 'ADMIN' : 'USER'}</span>
                </button>
              </div>
            )}
          </div>
        </div>

      </aside>

      {/* ── Main Viewport Area ── */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0 relative">
        
        {/* Gemini Deep Black Navbar */}
        <header className="h-14 border-b border-white/[0.08] bg-[#000000] flex items-center justify-between px-4 sm:px-6 shrink-0 z-20">

          {/* Top Right */}
          <div className="flex items-center gap-3">
            {connectedDb ? (
              <div 
                onClick={() => {
                  if (isAdmin) setIsConnectModalOpen(true);
                  else alert("Only Admins can change database connection strings.");
                }}
                className="flex items-center gap-2 bg-[#121215] hover:bg-[#1a1a1e] border border-white/[0.12] px-3 py-1.5 rounded-xl text-xs text-white transition-all cursor-pointer animate-fade-in"
                title={isAdmin ? "Click to switch database" : "Current Database"}
              >
                <Database className="w-3.5 h-3.5 text-white" />
                <span className="font-medium text-white">{connectedDb.name}</span>
                <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono ml-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Live
                </span>
              </div>
            ) : (
              <button
                onClick={() => {
                  if (isAdmin) setIsConnectModalOpen(true);
                  else alert("Only Admins can connect external database URIs.");
                }}
                className="flex items-center gap-2 bg-[#121215] hover:bg-[#1a1a1e] border border-dashed border-white/[0.2] hover:border-white/[0.4] px-3 py-1.5 rounded-xl text-xs text-neutral-300 hover:text-white transition-all cursor-pointer"
                title="Connect a Database"
              >
                <Plug className="w-3.5 h-3.5 text-neutral-400" />
                <span>Connect Database</span>
              </button>
            )}

          </div>
        </header>
        
        {/* Child Page Container */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#000000]">
          {children}
        </div>
      </main>

      <ConnectDbModal 
        isOpen={isConnectModalOpen} 
        onClose={() => setIsConnectModalOpen(false)} 
        onConnect={handleConnectDb}
        userRole={userRole}
        isConnecting={isConnectingDb}
        connectError={connectDbError}
      />

      <RoleVerificationModal
        isOpen={isRoleModalOpen}
        onClose={() => setIsRoleModalOpen(false)}
        currentRole={userRole}
        onUpdateRole={setUserRole}
      />
    </div>
  );
};

export default function App() {
  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <ChatProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={
              <>
                <SignedOut><LandingPage /></SignedOut>
                <SignedIn><Navigate to="/app" replace /></SignedIn>
              </>
            } />
            <Route path="/app/*" element={
              <>
                <SignedIn>
                  <DashboardLayout>
                    <Routes>
                      <Route path="/" element={<QueryWorkbench />} />
                      <Route path="/schema" element={<SchemaExplorer />} />
                      <Route path="/telemetry" element={<Telemetry />} />
                    </Routes>
                  </DashboardLayout>
                </SignedIn>
                <SignedOut><Navigate to="/" replace /></SignedOut>
              </>
            } />
          </Routes>
        </BrowserRouter>
      </ChatProvider>
    </ClerkProvider>
  );
}
