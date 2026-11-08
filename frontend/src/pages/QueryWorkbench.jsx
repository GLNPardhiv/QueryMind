// src/pages/QueryWorkbench.jsx
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useAuth, useUser } from '@clerk/clerk-react';
import Editor from '@monaco-editor/react';
import { 
  Play, Sparkles, CheckCircle2, XCircle, Table2, AlertCircle,
  Send, Copy, Check, Terminal, BarChart3, Download, Paperclip,
  ShieldCheck, RefreshCw, Database, Code2, Clock, FileCode,
  ChevronRight, X, ExternalLink, ArrowRight, MessageSquare,
  CornerDownRight, Plus
} from 'lucide-react';
import { 
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';

import { useChat } from '../context/ChatContext';

const STARTER_PROMPTS = [
  { label: "Top 5 Customers by Sales", query: "Get top 5 customers by sales revenue" },
  { label: "Products with Low Stock", query: "List products with lowest inventory stock levels" },
  { label: "Revenue by Territory", query: "Show total sales revenue grouped by territory" },
  { label: "RBAC Test: Employee Pay History", query: "Select all records from employeepayhistory" }
];

export default function QueryWorkbench() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const { 
    activeChat, addMessageToActiveChat, activeWorkbenchSql, 
    setActiveWorkbenchSql, workbenchMode, setWorkbenchMode, openInWorkbench,
    userRole, isAdmin, connectedDb
  } = useChat();

  const getHeaders = async () => {
    try {
      const token = await getToken();
      return {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-User-Id': user?.id || '',
        'X-User-Email': user?.primaryEmailAddress?.emailAddress || '',
        'X-User-Role': userRole || 'STANDARD_USER'
      };
    } catch {
      return {
        'X-User-Id': user?.id || '',
        'X-User-Email': user?.primaryEmailAddress?.emailAddress || '',
        'X-User-Role': userRole || 'STANDARD_USER'
      };
    }
  };

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  // Input & state
  const [inputQuery, setInputQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedSqlId, setCopiedSqlId] = useState(null);
  const [executingMsgId, setExecutingMsgId] = useState(null);

  // Chat Query Mode: 'new' (New Question) | 'followup' (Ask regarding above question)
  const [chatQueryMode, setChatQueryMode] = useState('new');

  // Identify the most recent assistant message with valid SQL for cross-questioning
  const lastAssistantWithSql = [...(activeChat?.messages || [])]
    .reverse()
    .find(m => m.sender === 'assistant' && m.sql);

  // Extract the corresponding user query for that previous SQL
  let lastUserQueryText = '';
  if (lastAssistantWithSql && activeChat?.messages) {
    const assistantIndex = activeChat.messages.findIndex(m => m.id === lastAssistantWithSql.id);
    if (assistantIndex > 0) {
      for (let i = assistantIndex - 1; i >= 0; i--) {
        if (activeChat.messages[i].sender === 'user') {
          lastUserQueryText = activeChat.messages[i].text;
          break;
        }
      }
    }
  }

  // Attached SQL File State
  const [attachedSqlFile, setAttachedSqlFile] = useState(null); // { name, size, content }

  // SQL Workbench Executions State
  const [rawSqlResult, setRawSqlResult] = useState(null);
  const [rawSqlLoading, setRawSqlLoading] = useState(false);
  const [rawSqlError, setRawSqlError] = useState(null);

  // Auto-scroll on messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChat?.messages, isGenerating]);

  // Handle SQL File Selection
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.sql') && !file.name.endsWith('.txt')) {
      alert("Please select a valid .sql file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setAttachedSqlFile({
        name: file.name,
        size: (file.size / 1024).toFixed(1) + ' KB',
        content: event.target.result
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Submit User Message in Chat Copilot (Does NOT execute directly, just returns SQL)
  const handleSendMessage = async (queryToSend) => {
    const text = (queryToSend || inputQuery).trim();
    if ((!text && !attachedSqlFile) || isGenerating) return;

    setIsGenerating(true);

    // If a SQL file is attached, inspect without auto-executing
    if (attachedSqlFile) {
      const fileData = attachedSqlFile;
      setAttachedSqlFile(null);
      setInputQuery('');

      const userMsgId = `user-${Date.now()}`;
      const assistantMsgId = `ast-${Date.now()}`;

      addMessageToActiveChat({
        id: userMsgId,
        sender: 'user',
        text: text ? `${text}\n[Attached: ${fileData.name}]` : `Inspected SQL File: ${fileData.name}`,
        fileAttachment: { name: fileData.name, size: fileData.size },
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }, fileData.name);

      try {
        const headers = await getHeaders();
        const res = await axios.post('http://127.0.0.1:8000/api/v1/upload-sql',
          {
            filename: fileData.name,
            content: fileData.content,
            action: 'inspect' // Just inspect and validate, do not execute directly
          },
          { headers }
        );

        const assistantMsg = {
          id: assistantMsgId,
          sender: 'assistant',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: res.data.status,
          sql: res.data.sql,
          validationMessage: res.data.validation_message || 'SQL file loaded and AST validated. Ready for execution in Workbench.',
          execution: null, // User executes when ready
          latencyMs: res.data.latency_ms || 8,
          statementsCount: res.data.statements_count,
          fileName: fileData.name
        };

        addMessageToActiveChat(assistantMsg);
        if (res.data.sql) setActiveWorkbenchSql(res.data.sql);

      } catch (err) {
        addMessageToActiveChat({
          id: assistantMsgId,
          sender: 'assistant',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: 'error',
          error: err.response?.data?.detail || err.message || 'Error processing SQL file'
        });
      } finally {
        setIsGenerating(false);
      }
      return;
    }

    // Standard natural language query: generates SQL without executing directly
    const isFollowup = chatQueryMode === 'followup' && Boolean(lastAssistantWithSql);

    setInputQuery('');
    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `ast-${Date.now()}`;

    const isFirst = activeChat?.messages.length === 0;
    const title = (isFirst && !isFollowup)
      ? (text.length > 28 ? text.substring(0, 28) + '...' : text)
      : null;

    addMessageToActiveChat({
      id: userMsgId,
      sender: 'user',
      text,
      isFollowUp: isFollowup,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }, title);

    try {
      const headers = await getHeaders();
      const payload = {
        query: text,
        is_followup: isFollowup,
        previous_sql: isFollowup ? lastAssistantWithSql.sql : null,
        previous_query: isFollowup ? lastUserQueryText : null,
        context_tables: isFollowup ? (lastAssistantWithSql.tablesUsed || []) : null,
        schema_context: connectedDb?.schema || null,
        database: connectedDb?.name || null
      };

      const res = await axios.post('http://127.0.0.1:8000/api/v1/generate-sql',
        payload,
        { 
          headers: { 
            ...headers,
            'Content-Type': 'application/json'
          } 
        }
      );

      const assistantMsg = {
        id: assistantMsgId,
        sender: 'assistant',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: res.data.status,
        sql: res.data.sql,
        validationMessage: res.data.validation_message,
        execution: null, // Generated code only; user executes in Workbench or via Run Query
        tablesUsed: res.data.context_tables_used || [],
        latencyMs: res.data.latency_ms || 12,
        isFollowUp: isFollowup
      };

      addMessageToActiveChat(assistantMsg);
      if (res.data.sql) setActiveWorkbenchSql(res.data.sql);

    } catch (err) {
      addMessageToActiveChat({
        id: assistantMsgId,
        sender: 'assistant',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'error',
        error: err.response?.data?.detail || err.message || 'Error communicating with database API'
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Optional on-demand execution directly in chat if user wants
  const handleExecuteInChat = async (msgId, sql) => {
    if (!sql || executingMsgId) return;
    setExecutingMsgId(msgId);
    try {
      const headers = await getHeaders();
      const res = await axios.post('http://127.0.0.1:8000/api/v1/raw-sql',
        { 
          sql,
          schema_context: connectedDb?.schema || null,
          database: connectedDb?.name || null
        },
        { headers }
      );

      // Attach execution data to this message
      const msg = activeChat?.messages.find(m => m.id === msgId);
      if (msg) {
        msg.execution = res.data.execution;
        msg.latencyMs = res.data.latency_ms;
      }
    } catch (err) {
      alert(err.response?.data?.detail || err.message || 'Execution error');
    } finally {
      setExecutingMsgId(null);
    }
  };

  // Run Raw SQL in the SQL Workbench View
  const handleRunRawSql = async () => {
    if (!activeWorkbenchSql.trim() || rawSqlLoading) return;
    setRawSqlLoading(true);
    setRawSqlError(null);
    setRawSqlResult(null);

    try {
      const headers = await getHeaders();
      const res = await axios.post('http://127.0.0.1:8000/api/v1/raw-sql',
        { 
          sql: activeWorkbenchSql,
          schema_context: connectedDb?.schema || null,
          database: connectedDb?.name || null
        },
        { headers }
      );

      if (res.data.status === 'blocked') {
        setRawSqlError(res.data.validation_message || 'Security Gate: Query blocked by AST analysis.');
      } else if (res.data.execution?.status === 'error') {
        setRawSqlError(res.data.execution.message);
      } else {
        setRawSqlResult(res.data);
      }
    } catch (err) {
      setRawSqlError(err.response?.data?.detail || err.message || 'Execution error');
    } finally {
      setRawSqlLoading(false);
    }
  };

  // Copy SQL snippet
  const handleCopySql = (sqlText, id) => {
    navigator.clipboard.writeText(sqlText);
    setCopiedSqlId(id);
    setTimeout(() => setCopiedSqlId(null), 2000);
  };

  // Export to CSV
  const handleExportCsv = (rows, filename = 'querymind_export.csv') => {
    if (!rows || rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csvContent = [
      headers.join(','),
      ...rows.map(r => headers.map(h => {
        const val = r[h] === null ? '' : String(r[h]).replace(/"/g, '""');
        return `"${val}"`;
      }).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Compute chart configuration
  const getChartConfig = (rows) => {
    if (!rows || rows.length === 0) return null;
    const keys = Object.keys(rows[0]);
    if (keys.length < 2) return null;

    let categoryKey = keys[0];
    let valueKey = null;

    for (const key of keys) {
      const val = rows[0][key];
      if (typeof val === 'number' || (!isNaN(Number(val)) && val !== null && val !== '')) {
        valueKey = key;
        break;
      }
    }

    if (!valueKey) return null;

    const chartData = rows.slice(0, 15).map(row => ({
      name: String(row[categoryKey] || 'N/A').substring(0, 18),
      value: Number(row[valueKey]) || 0
    }));

    return { categoryKey: 'name', valueKey: 'value', originalKey: valueKey, chartData };
  };

  return (
    <div className="h-full flex-1 flex flex-col bg-[#000000] text-white overflow-hidden font-sans min-h-0">

      {/* ============================================================== */}
      {/* MODE 1: CHAT COPILOT VIEW                                      */}
      {/* ============================================================== */}
      {workbenchMode === 'chat' && (
        <div className="flex-1 flex flex-col overflow-hidden relative min-h-0">
          
          {/* Messages Scroll Area */}
          <div className="flex-1 overflow-y-auto w-full min-h-0">
            <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
              
              {/* Empty State / Starters */}
              {activeChat?.messages.length === 0 && (
                <div className="py-12 text-center animate-fade-in">
                  <div className="w-12 h-12 rounded-2xl bg-[#09090b] border border-white/[0.1] text-white flex items-center justify-center mx-auto mb-4">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <h2 className="text-2xl font-semibold text-white mb-2 tracking-tight">
                    QueryMind Copilot
                  </h2>
                  <p className="text-neutral-400 text-sm mb-8 max-w-md mx-auto leading-relaxed">
                    Ask natural language questions or attach a <code className="text-white bg-white/[0.08] px-1.5 py-0.5 rounded font-mono border border-white/[0.1]">.sql</code> file to generate, inspect, and validate SQL.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left max-w-xl mx-auto">
                    {STARTER_PROMPTS.map((starter, i) => (
                      <button
                        key={i}
                        onClick={() => handleSendMessage(starter.query)}
                        className="p-3.5 rounded-2xl bg-[#0e0e11] hover:bg-[#141418] border border-white/[0.08] hover:border-white/[0.2] transition-all text-left group cursor-pointer"
                      >
                        <div className="text-xs font-semibold text-white mb-1 flex items-center justify-between">
                          <span>{starter.label}</span>
                          <ChevronRight className="w-3.5 h-3.5 text-neutral-500 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
                        </div>
                        <div className="text-xs text-neutral-400 line-clamp-1">{starter.query}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Chronological Messages */}
              {activeChat?.messages.map((msg) => {
                if (msg.sender === 'user') {
                  return (
                    <div key={msg.id} className="flex justify-end animate-fade-in">
                      <div className="max-w-2xl bg-[#18181b] text-white rounded-3xl px-5 py-3.5 border border-white/[0.08]">
                        {msg.isFollowUp && (
                          <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-mono mb-2 pb-1.5 border-b border-white/[0.08]">
                            <CornerDownRight className="w-3 h-3 text-emerald-400" />
                            <span>Follow-up question / refinement</span>
                          </div>
                        )}
                        {msg.fileAttachment && (
                          <div className="flex items-center gap-2 mb-2 p-2 rounded-xl bg-black/60 border border-white/[0.08] text-xs font-mono text-white">
                            <FileCode className="w-4 h-4 text-white" />
                            <span>{msg.fileAttachment.name}</span>
                            <span className="text-[10px] text-neutral-400">({msg.fileAttachment.size})</span>
                          </div>
                        )}
                        <div className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</div>
                        <div className="text-[10px] text-neutral-400 mt-1 text-right">{msg.timestamp}</div>
                      </div>
                    </div>
                  );
                }

                // Assistant Response Card (Does not execute directly; user reviews and opens in workbench)
                const chartConfig = msg.execution?.data ? getChartConfig(msg.execution.data) : null;
                const columns = msg.execution?.data?.length > 0 ? Object.keys(msg.execution.data[0]) : [];

                return (
                  <div key={msg.id} className="flex gap-3 max-w-4xl animate-fade-in">
                    {/* Minimal Avatar */}
                    <div className="w-8 h-8 rounded-xl bg-[#09090b] border border-white/[0.1] text-white flex items-center justify-center shrink-0 mt-1">
                      <Sparkles className="w-4 h-4" />
                    </div>

                    <div className="flex-1 bg-[#0d0d10] border border-white/[0.08] rounded-3xl overflow-hidden">
                      
                      {/* Top Status Pill Bar */}
                      <div className="bg-[#131316] px-4 py-2.5 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {msg.status === 'success' ? (
                            <span className="flex items-center gap-1.5 text-xs text-white font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> AST Validated
                            </span>
                          ) : msg.status === 'blocked' ? (
                            <span className="flex items-center gap-1.5 text-xs text-amber-300 font-medium">
                              <AlertCircle className="w-3.5 h-3.5 text-amber-400" /> AST Blocked
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 text-xs text-rose-300 font-medium">
                              <XCircle className="w-3.5 h-3.5 text-rose-400" /> Error
                            </span>
                          )}

                          {msg.latencyMs && (
                            <span className="text-[11px] font-mono text-neutral-400 bg-white/[0.04] px-2 py-0.5 rounded-md">
                              {msg.latencyMs}ms
                            </span>
                          )}

                          {msg.isFollowUp && (
                            <span className="flex items-center gap-1 text-[11px] font-mono text-neutral-300 bg-white/[0.06] border border-white/10 px-2 py-0.5 rounded-md">
                              <CornerDownRight className="w-3 h-3 text-emerald-400" /> Refined Query
                            </span>
                          )}
                        </div>

                        {/* Open in SQL Workbench Button */}
                        {msg.sql && (
                          <div className="flex items-center gap-2">
                            {!msg.execution && (
                              <button
                                onClick={() => handleExecuteInChat(msg.id, msg.sql)}
                                disabled={executingMsgId === msg.id}
                                className="flex items-center gap-1.5 bg-[#1f1f23] hover:bg-[#27272a] text-white border border-white/10 px-3 py-1 rounded-xl text-xs font-medium transition-all cursor-pointer"
                                title="Run this query directly"
                              >
                                <Play className="w-3 h-3 text-emerald-400" />
                                <span>{executingMsgId === msg.id ? 'Running...' : 'Run Query'}</span>
                              </button>
                            )}

                            <button
                              onClick={() => openInWorkbench(msg.sql)}
                              className="flex items-center gap-1.5 bg-white hover:bg-neutral-200 text-black px-3.5 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-sm"
                              title="Open this query in full SQL Workbench"
                            >
                              <Terminal className="w-3.5 h-3.5" />
                              <span>Open in Workbench</span>
                              <ExternalLink className="w-3 h-3 opacity-60" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Card Content */}
                      <div className="p-4 sm:p-5 space-y-4">
                        
                        {/* Error or Blocked Notice */}
                        {msg.status === 'blocked' && (
                          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200 flex items-start gap-2.5">
                            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                            <div>
                              <div className="font-semibold text-amber-300">AST Security Gate:</div>
                              <div className="mt-0.5">{msg.validationMessage}</div>
                            </div>
                          </div>
                        )}

                        {msg.status === 'error' && (
                          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-200 flex items-start gap-2.5">
                            <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                            <div>
                              <div className="font-semibold text-rose-300">Execution Error:</div>
                              <div className="mt-0.5">{msg.error}</div>
                            </div>
                          </div>
                        )}

                        {/* SQL Code Block */}
                        {msg.sql && (
                          <div className="rounded-2xl border border-white/[0.08] bg-[#050507] overflow-hidden">
                            <div className="bg-[#0f0f13] px-3.5 py-2 border-b border-white/[0.06] flex items-center justify-between">
                              <span className="text-xs font-mono text-neutral-400 flex items-center gap-1.5">
                                <Code2 className="w-3.5 h-3.5 text-white" /> Generated SQL
                              </span>
                              <button
                                onClick={() => handleCopySql(msg.sql, msg.id)}
                                className="text-xs text-neutral-400 hover:text-white flex items-center gap-1 cursor-pointer transition-colors"
                              >
                                {copiedSqlId === msg.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                <span>{copiedSqlId === msg.id ? 'Copied' : 'Copy'}</span>
                              </button>
                            </div>
                            <pre className="p-3.5 font-mono text-xs text-neutral-200 overflow-x-auto leading-relaxed">
                              {msg.sql}
                            </pre>
                          </div>
                        )}

                        {/* Query Output Results (Shown only after user executes) */}
                        {msg.execution?.data && (
                          <div className="space-y-3 pt-1">
                            
                            {/* Controls bar */}
                            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                                  <Table2 className="w-3.5 h-3.5 text-white" /> Result Set
                                </span>
                                <span className="text-[11px] font-mono text-neutral-400 bg-white/[0.05] px-2 py-0.5 rounded-full">
                                  {msg.execution.row_count || 0} rows
                                </span>
                              </div>

                              <button
                                onClick={() => handleExportCsv(msg.execution.data)}
                                className="flex items-center gap-1 text-xs text-neutral-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 px-3 py-1 rounded-xl transition-all cursor-pointer"
                              >
                                <Download className="w-3.5 h-3.5" /> Export CSV
                              </button>
                            </div>

                            {/* Data Table */}
                            <div className="overflow-x-auto rounded-xl border border-white/[0.08] max-h-72 bg-[#000000]">
                              {msg.execution.data.length === 0 ? (
                                <div className="p-8 text-center text-xs text-neutral-400">No records found.</div>
                              ) : (
                                <table className="w-full text-left text-xs border-collapse">
                                  <thead className="bg-[#0f0f13] sticky top-0 border-b border-white/[0.08] z-10">
                                    <tr>
                                      {columns.map(col => (
                                        <th key={col} className="px-4 py-2 font-semibold text-neutral-400 uppercase tracking-wider text-[11px] whitespace-nowrap">
                                          {col}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-white/[0.04]">
                                    {msg.execution.data.map((row, rIdx) => (
                                      <tr key={rIdx} className="hover:bg-white/[0.02] transition-colors">
                                        {columns.map(col => (
                                          <td key={col} className="px-4 py-2 text-white font-mono whitespace-nowrap max-w-xs truncate" title={String(row[col])}>
                                            {row[col] === null ? (
                                              <span className="text-neutral-600 italic">null</span>
                                            ) : typeof row[col] === 'number' ? (
                                              <span className="text-white font-medium">{row[col].toLocaleString()}</span>
                                            ) : (
                                              String(row[col])
                                            )}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>

                            {/* Chart View if numbers present */}
                            {chartConfig && (
                              <div className="mt-3 p-4 rounded-xl border border-white/[0.08] bg-[#000000] h-56">
                                <div className="text-xs text-neutral-400 mb-2 font-mono flex items-center justify-between">
                                  <span>Visualized: <strong className="text-white">{chartConfig.originalKey}</strong></span>
                                  <span className="text-[10px] text-neutral-500">Auto-detected</span>
                                </div>
                                <ResponsiveContainer width="100%" height="85%">
                                  <BarChart data={chartConfig.chartData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1f1f23" />
                                    <XAxis dataKey="name" stroke="#71717a" fontSize={10} tickLine={false} />
                                    <YAxis stroke="#71717a" fontSize={10} tickLine={false} />
                                    <Tooltip 
                                      contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '10px', color: '#FFFFFF' }}
                                    />
                                    <Bar dataKey="value" fill="#ffffff" radius={[4, 4, 0, 0]} />
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>
                            )}

                          </div>
                        )}

                      </div>

                    </div>
                  </div>
                );
              })}

              {/* Loading Indicator */}
              {isGenerating && (
                <div className="flex gap-3 max-w-2xl animate-fade-in">
                  <div className="w-8 h-8 rounded-xl bg-[#09090b] border border-white/[0.1] text-white flex items-center justify-center shrink-0">
                    <Sparkles className="w-4 h-4 animate-spin" />
                  </div>
                  <div className="bg-[#0e0e11] border border-white/[0.08] rounded-2xl p-4 text-xs text-neutral-300 flex items-center gap-3">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                    </span>
                    <span>Formulating SQL schema relationships & AST validation...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Gemini Deep Black Floating Capsule Prompt Bar */}
          <div className="p-4 sm:p-5 shrink-0 bg-gradient-to-t from-[#000000] via-[#000000]/95 to-transparent">
            <div className="max-w-3xl mx-auto">
              
              {/* Question Mode Switcher (New Question vs Ask Regarding Above Question) */}
              <div className="mb-2.5 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center bg-[#09090b] p-1 rounded-full border border-white/[0.1] text-xs">
                    <button
                      type="button"
                      onClick={() => setChatQueryMode('new')}
                      className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                        chatQueryMode === 'new'
                          ? 'bg-white text-black shadow-sm'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      <Plus className="w-3 h-3" />
                      <span>New Question</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (lastAssistantWithSql) setChatQueryMode('followup');
                      }}
                      disabled={!lastAssistantWithSql}
                      title={
                        !lastAssistantWithSql
                          ? "Submit a question first to enable follow-ups"
                          : "Cross-question or correct the previous SQL response"
                      }
                      className={`px-3 py-1 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
                        !lastAssistantWithSql
                          ? 'opacity-40 cursor-not-allowed text-neutral-500'
                          : chatQueryMode === 'followup'
                            ? 'bg-white text-black shadow-sm cursor-pointer'
                            : 'text-neutral-400 hover:text-white cursor-pointer'
                      }`}
                    >
                      <CornerDownRight className="w-3 h-3" />
                      <span>Ask Regarding Above Question</span>
                    </button>
                  </div>

                  {chatQueryMode === 'followup' && lastAssistantWithSql && (
                    <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-neutral-400 font-mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                      <span>Single-Turn Refinement (RPM Safe)</span>
                    </div>
                  )}
                </div>

                {/* Active Context Preview Banner when Follow-up Mode is Active */}
                {chatQueryMode === 'followup' && lastAssistantWithSql && (
                  <div className="flex items-center justify-between bg-[#111115] border border-white/[0.14] rounded-2xl px-3.5 py-2 text-xs animate-fade-in">
                    <div className="flex items-center gap-2 truncate min-w-0 mr-2 text-neutral-300">
                      <CornerDownRight className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="text-neutral-400 font-medium shrink-0">Cross-questioning:</span>
                      <code className="font-mono text-white text-[11px] bg-black/60 px-2 py-0.5 rounded border border-white/10 truncate">
                        {lastAssistantWithSql.sql.replace(/\s+/g, ' ').substring(0, 75)}...
                      </code>
                    </div>
                    <button
                      type="button"
                      onClick={() => setChatQueryMode('new')}
                      className="text-[11px] text-neutral-400 hover:text-white underline cursor-pointer shrink-0 transition-colors"
                    >
                      Reset to New Question
                    </button>
                  </div>
                )}
              </div>

              {/* Attached SQL File Chip */}
              {attachedSqlFile && (
                <div className="mb-2 flex items-center gap-2 bg-[#0e0e11] border border-white/[0.15] text-white px-3.5 py-1.5 rounded-full text-xs font-mono w-fit animate-fade-in">
                  <FileCode className="w-4 h-4 text-white shrink-0" />
                  <span>{attachedSqlFile.name}</span>
                  <span className="text-[10px] text-neutral-400">({attachedSqlFile.size})</span>
                  <button 
                    onClick={() => setAttachedSqlFile(null)}
                    className="ml-1 text-neutral-400 hover:text-white p-0.5 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Hidden File Input */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".sql,.txt"
                className="hidden"
              />

              {/* Capsule Input Bar */}
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="relative flex items-center bg-[#0e0e11] border border-white/[0.14] rounded-full focus-within:border-white focus-within:ring-1 focus-within:ring-white transition-all px-3 py-2"
              >
                {/* File Attachment Button */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 text-neutral-400 hover:text-white rounded-full hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
                  title="Upload .sql file"
                >
                  <Paperclip className="w-4 h-4" />
                </button>

                <input
                  type="text"
                  value={inputQuery}
                  onChange={(e) => setInputQuery(e.target.value)}
                  placeholder={
                    attachedSqlFile 
                      ? `File ready: ${attachedSqlFile.name}. Press Send to inspect...` 
                      : chatQueryMode === 'followup' && lastAssistantWithSql
                        ? "Ask a cross-question or correction (e.g. 'filter by 2013 instead', 'use left join')..."
                        : "Ask a database question or attach a .sql file..."
                  }
                  disabled={isGenerating}
                  className="w-full bg-transparent text-white placeholder-neutral-600 text-sm py-1.5 px-3 outline-none"
                />

                <button
                  type="submit"
                  disabled={(!inputQuery.trim() && !attachedSqlFile) || isGenerating}
                  className="bg-white text-black hover:bg-neutral-200 disabled:opacity-30 disabled:hover:bg-white p-2.5 rounded-full transition-all cursor-pointer shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>

              <div className="flex items-center justify-between mt-2 px-3 text-[11px] text-neutral-500">
                <span>
                  {chatQueryMode === 'followup'
                    ? "Enter to submit follow-up • Context-optimized single call"
                    : "Enter to submit • Shows code for review before running"}
                </span>
                <span>Deterministic AST Security Gate Active</span>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ============================================================== */}
      {/* MODE 2: FULL SQL WORKBENCH VIEW                                 */}
      {/* ============================================================== */}
      {workbenchMode === 'workbench' && (
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden p-4 sm:p-6 gap-5 min-h-0 bg-[#000000]">
          
          {/* Left: Monaco SQL Editor */}
          <div className="flex-1 bg-[#09090b] border border-white/[0.08] rounded-2xl flex flex-col overflow-hidden min-h-0">
            <div className="bg-[#0e0e11] px-4 py-3 border-b border-white/[0.08] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-white" />
                <span className="text-xs font-semibold text-white tracking-wide">RAW SQL EDITOR</span>
              </div>

              <div className="flex items-center gap-3">

                <button
                  onClick={handleRunRawSql}
                  disabled={rawSqlLoading || !activeWorkbenchSql.trim()}
                  className="flex items-center gap-2 bg-white hover:bg-neutral-200 disabled:opacity-40 text-black text-xs px-4 py-1.5 rounded-xl font-semibold transition-all cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{rawSqlLoading ? 'Executing...' : 'Run SQL'}</span>
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-[300px]">
              <Editor
                height="100%"
                defaultLanguage="sql"
                theme="vs-dark"
                value={activeWorkbenchSql}
                onChange={(val) => setActiveWorkbenchSql(val || '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  padding: { top: 16 },
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true
                }}
              />
            </div>
          </div>

          {/* Right: Execution Output Pane */}
          <div className="w-full lg:w-[480px] bg-[#09090b] border border-white/[0.08] rounded-2xl flex flex-col overflow-hidden min-h-0">
            <div className="bg-[#0e0e11] px-4 py-3 border-b border-white/[0.08] flex items-center justify-between shrink-0">
              <span className="text-xs font-semibold text-white tracking-wide flex items-center gap-2">
                <Table2 className="w-4 h-4 text-white" /> EXECUTION RESULTS
              </span>

              {rawSqlResult?.execution && (
                <button
                  onClick={() => handleExportCsv(rawSqlResult.execution.data)}
                  className="flex items-center gap-1 text-[11px] text-neutral-300 hover:text-white bg-white/[0.04] px-2.5 py-1 rounded-lg border border-white/10 transition-colors cursor-pointer"
                >
                  <Download className="w-3 h-3" /> Export CSV
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
              {rawSqlError && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-200">
                  <div className="font-semibold text-rose-300 mb-1 flex items-center gap-1.5">
                    <XCircle className="w-4 h-4" /> Execution Blocked / Failed:
                  </div>
                  {rawSqlError}
                </div>
              )}

              {rawSqlResult?.execution ? (
                <div>
                  <div className="flex items-center justify-between text-xs text-white font-mono mb-3">
                    <span className="flex items-center gap-1 text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" /> AST Passed
                    </span>
                    <span className="text-neutral-400">{rawSqlResult.execution.row_count || 0} rows in {rawSqlResult.latency_ms || 12}ms</span>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-white/[0.08] max-h-96 bg-[#000000]">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-[#0e0e11] sticky top-0 border-b border-white/[0.08]">
                        <tr>
                          {Object.keys(rawSqlResult.execution.data[0] || {}).map(col => (
                            <th key={col} className="p-2.5 text-neutral-400 uppercase tracking-wider text-[10px] whitespace-nowrap">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.04] font-mono">
                        {rawSqlResult.execution.data.map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-white/[0.02]">
                            {Object.keys(rawSqlResult.execution.data[0] || {}).map(col => (
                              <td key={col} className="p-2.5 text-white truncate max-w-[140px]" title={String(row[col])}>
                                {String(row[col])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : !rawSqlError && (
                <div className="h-full flex flex-col items-center justify-center text-xs text-neutral-500 py-12">
                  <Terminal className="w-8 h-8 mb-2 opacity-30 text-white" />
                  <span>Click "Run SQL" to execute and inspect live rows.</span>
                </div>
              )}
            </div>
          </div>

        </div>
      )}

    </div>
  );
}
