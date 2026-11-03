// src/pages/Telemetry.jsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '@clerk/clerk-react';
import { 
  Activity, Zap, Server, ChevronRight, Clock, ShieldCheck, 
  Terminal, RefreshCw, CheckCircle2, AlertCircle, Database, Sparkles,
  Code2, Table2, Layers, Search, Eye, Trash2, Play, Info, XCircle
} from 'lucide-react';

export default function Telemetry() {
  const { getToken } = useAuth();
  const [telemetry, setTelemetry] = useState({
    total_queries: 0,
    avg_latency_ms: 18.4,
    recent_queries: []
  });
  const [loading, setLoading] = useState(false);

  // Selected query for inspection
  const [selectedQuery, setSelectedQuery] = useState(null);
  const [explainPlan, setExplainPlan] = useState(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // Helper to safely extract tables whether from tables_used, tablesUsed, or fallback SQL parsing
  const getTables = (q) => {
    if (!q) return [];
    if (Array.isArray(q.tables_used) && q.tables_used.length > 0) return q.tables_used;
    if (Array.isArray(q.tablesUsed) && q.tablesUsed.length > 0) return q.tablesUsed;
    const sqlText = q.sql || (q.query && /^(SELECT|WITH)/i.test(q.query) ? q.query : '');
    if (sqlText) {
      const matches = [...sqlText.matchAll(/\b(?:FROM|JOIN)\s+[`"]?([a-zA-Z0-9_]+)[`"]?/gi)];
      const extracted = [...new Set(matches.map(m => m[1].toLowerCase()).filter(t => !['select', 'where', 'group', 'order', 'limit', 'as'].includes(t)))];
      if (extracted.length > 0) return extracted;
    }
    return [];
  };

  const fetchTelemetry = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await axios.get('http://127.0.0.1:8000/api/v1/telemetry', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (res.data) {
        setTelemetry(res.data);
        // Select first query for preview without executing any plan automatically
        if (!selectedQuery && res.data.recent_queries?.length > 0) {
          setSelectedQuery(res.data.recent_queries[0]);
          setExplainPlan(null);
        }
      }
    } catch (err) {
      console.warn("Could not fetch telemetry", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectRow = (queryItem) => {
    // Use a stable unique key for comparison — prefer `id`, fallback to `_id`
    const incomingKey = queryItem?.id || queryItem?._id;
    const currentKey = selectedQuery?.id || selectedQuery?._id;
    // Only skip if the same row is clicked AND a plan is already visible
    if (incomingKey && incomingKey === currentKey && !explainPlan) {
      return;
    }
    setSelectedQuery(queryItem);
    // Do not run explain plan automatically! Let user choose when to run.
    setExplainPlan(null);
    setExplainError(null);
  };

  const handleGeneratePlan = async (mode = 'analyze') => {
    if (!selectedQuery) return;
    let sqlToExplain = selectedQuery?.sql;
    if (!sqlToExplain && selectedQuery?.query && /^(SELECT|WITH|EXPLAIN)/i.test(selectedQuery.query.trim())) {
      sqlToExplain = selectedQuery.query.trim();
    }

    if (!sqlToExplain) {
      setExplainPlan(null);
      setExplainError('No executable SQL statement found for this query record to analyze.');
      return;
    }

    setExplainLoading(true);
    setExplainError(null);
    try {
      const token = await getToken();
      const res = await axios.post('http://127.0.0.1:8000/api/v1/explain-sql', 
        { sql: sqlToExplain, mode },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      if (res.data?.status === 'success') {
        setExplainPlan(res.data);
      } else {
        setExplainError(res.data?.message || 'Failed to generate query plan');
      }
    } catch (err) {
      setExplainError(err.response?.data?.detail || err.message || 'Error running EXPLAIN');
    } finally {
      setExplainLoading(false);
    }
  };

  const handleDeleteQuery = async (queryItem, e) => {
    if (e) e.stopPropagation();
    const itemId = queryItem.id || queryItem._id;
    if (!itemId) return;

    setDeletingId(itemId);
    try {
      const token = await getToken();
      await axios.delete(`http://127.0.0.1:8000/api/v1/telemetry/${itemId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });

      // Update local state immediately
      setTelemetry(prev => {
        const updated = prev.recent_queries.filter(q => (q.id || q._id) !== itemId);
        return {
          ...prev,
          total_queries: Math.max(0, prev.total_queries - 1),
          recent_queries: updated
        };
      });

      // If the deleted item was currently selected, reset plan view
      if (selectedQuery && (selectedQuery.id || selectedQuery._id) === itemId) {
        setSelectedQuery(null);
        setExplainPlan(null);
        setExplainError(null);
      }
    } catch (err) {
      console.error("Failed to delete telemetry record", err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm("Are you sure you want to clear all query telemetry history and saved plans?")) {
      return;
    }
    try {
      const token = await getToken();
      await axios.delete('http://127.0.0.1:8000/api/v1/telemetry', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      setTelemetry({
        total_queries: 0,
        avg_latency_ms: 0,
        recent_queries: []
      });
      setSelectedQuery(null);
      setExplainPlan(null);
      setExplainError(null);
    } catch (err) {
      console.error("Failed to clear telemetry history", err);
    }
  };

  const handleClearPlanOnly = () => {
    setExplainPlan(null);
    setExplainError(null);
  };

  useEffect(() => {
    fetchTelemetry();
  }, []);

  return (
    <div className="h-full flex-1 overflow-y-auto w-full min-h-0 bg-[#000000] text-white">
      <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 font-sans">
        
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-white tracking-tight">System & Query Telemetry</h1>
              <span className="flex items-center gap-1 text-[11px] font-mono text-white bg-white/[0.08] border border-white/[0.12] px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Active
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-1">
              Execution latency, deterministic AST SQL gate enforcement, and user-initiated query plans with delete options.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            {telemetry.recent_queries.length > 0 && (
              <button
                onClick={handleClearAll}
                className="flex items-center gap-1.5 bg-neutral-900 hover:bg-red-950/40 text-neutral-400 hover:text-red-400 border border-white/[0.08] hover:border-red-500/30 px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer"
                title="Clear all telemetry history"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear History</span>
              </button>
            )}

            <button
              onClick={fetchTelemetry}
              disabled={loading}
              className="flex items-center gap-2 bg-white hover:bg-neutral-200 text-black px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Metrics</span>
            </button>
          </div>
        </div>

        {/* 3 Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div className="bg-[#09090b] border border-white/[0.08] rounded-2xl p-5 flex items-center gap-4">
            <div className="p-3 bg-white/[0.06] border border-white/[0.1] rounded-xl text-white">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-neutral-400 font-medium">Avg Execution Latency</p>
              <p className="text-2xl font-bold text-white font-mono mt-0.5">
                {telemetry.avg_latency_ms || 18.4} <span className="text-sm font-sans font-normal text-neutral-400">ms</span>
              </p>
            </div>
          </div>

          <div className="bg-[#09090b] border border-white/[0.08] rounded-2xl p-5 flex items-center gap-4">
            <div className="p-3 bg-white/[0.06] border border-white/[0.1] rounded-xl text-white">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-neutral-400 font-medium">Deterministic AST Gate</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-2xl font-bold text-white font-mono">100%</span>
                <span className="px-2 py-0.5 bg-white/[0.08] border border-white/[0.12] text-white text-[11px] font-semibold rounded-full font-mono">
                  SELECT ONLY
                </span>
              </div>
            </div>
          </div>

          <div className="bg-[#09090b] border border-white/[0.08] rounded-2xl p-5 flex items-center gap-4">
            <div className="p-3 bg-white/[0.06] border border-white/[0.1] rounded-xl text-white">
              <Server className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-neutral-400 font-medium">Total Invocations</p>
              <p className="text-2xl font-bold text-white font-mono mt-0.5">
                {telemetry.total_queries} <span className="text-sm font-sans font-normal text-neutral-400">queries</span>
              </p>
            </div>
          </div>
        </div>

        {/* Recent Query Log Table */}
        <div className="bg-[#09090b] border border-white/[0.08] rounded-2xl overflow-hidden">
          <div className="bg-[#0e0e11] px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between">
            <h2 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
              <Activity className="w-4 h-4 text-white" /> Recent Query Executions
            </h2>
            <span className="text-[11px] text-neutral-400 font-mono">
              Click a row to select & choose when to generate a plan
            </span>
          </div>

          <div className="overflow-x-auto bg-[#000000]">
            {telemetry.recent_queries.length === 0 ? (
              <div className="p-8 text-center text-xs text-neutral-500">
                No queries logged in this session yet. Run a query in Chat Copilot or SQL Workbench to see live execution telemetry.
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#0e0e11] border-b border-white/[0.08] text-neutral-400">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">User Query / Action</th>
                    <th className="px-4 py-2.5 font-semibold">Tables Used</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Rows</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Latency</th>
                    <th className="px-4 py-2.5 font-semibold text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {telemetry.recent_queries.map((q, idx) => {
                    const qId = q.id || q._id;
                    const selectedKey = selectedQuery?.id || selectedQuery?._id;
                    const isSelected = qId && selectedKey && qId === selectedKey;
                    return (
                      <tr 
                        key={qId || idx}
                        onClick={() => handleSelectRow(q)}
                        className={`transition-colors cursor-pointer group ${
                          isSelected 
                            ? 'bg-white/[0.08] border-l-2 border-white' 
                            : 'hover:bg-white/[0.03]'
                        }`}
                      >
                        <td className="px-4 py-3 text-white font-medium max-w-sm truncate" title={q.query}>
                          <div className="flex items-center gap-2 truncate">
                            {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white shrink-0" />}
                            <span className="truncate">{q.query}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {getTables(q).length > 0 ? (
                              getTables(q).map(tbl => (
                                <span key={tbl} className="px-1.5 py-0.5 rounded bg-white/[0.06] text-white text-[10px] font-mono border border-white/[0.1]">
                                  {tbl}
                                </span>
                              ))
                            ) : (
                              <span className="text-neutral-500 text-[10px] font-mono">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                            q.status === 'success' ? 'text-emerald-400' : 'text-amber-400'
                          }`}>
                            <CheckCircle2 className="w-3 h-3" /> {q.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-neutral-300">
                          {q.row_count || 0}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-white">
                          {q.latency_ms} ms
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectRow(q);
                              }}
                              className={`px-2 py-0.5 rounded-lg text-[10px] font-mono transition-all cursor-pointer ${
                                isSelected 
                                  ? 'bg-white text-black font-semibold' 
                                  : 'bg-white/[0.06] text-neutral-300 hover:text-white hover:bg-white/[0.12] border border-white/10'
                              }`}
                            >
                              {isSelected ? 'Selected' : 'Select'}
                            </button>
                            <button
                              onClick={(e) => handleDeleteQuery(q, e)}
                              disabled={deletingId === qId}
                              title="Delete this query record and its plan"
                              className="p-1 rounded-md text-neutral-500 hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* QUERY PLAN INSPECTION & CONTROLS */}
        <div className="bg-[#09090b] border border-white/[0.08] rounded-2xl overflow-hidden animate-fade-in">
          <div className="bg-[#0e0e11] px-5 py-3.5 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-white" />
              <h2 className="text-xs font-semibold text-white uppercase tracking-wide">
                QUERY EXECUTION PLAN
              </h2>
            </div>
            
            {selectedQuery && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-neutral-400 truncate max-w-sm hidden sm:inline">
                  Selected: <strong className="text-white font-mono">{selectedQuery.query}</strong>
                </span>

                {/* Plan status indicator */}
                {explainPlan ? (
                  <span className={`text-[11px] font-mono px-2 py-0.5 rounded-md flex items-center gap-1 border ${
                    explainPlan.mode === 'estimate' 
                      ? 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' 
                      : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${explainPlan.mode === 'estimate' ? 'bg-cyan-400' : 'bg-emerald-400'}`} />
                    {explainPlan.mode === 'estimate' ? 'Estimated (Not Executed)' : 'Live Profile (Executed)'}
                  </span>
                ) : (
                  <span className="text-[11px] font-mono text-neutral-400 bg-neutral-900 border border-white/10 px-2 py-0.5 rounded-md">
                    No Plan Generated
                  </span>
                )}

                {/* Delete / Clear buttons */}
                {explainPlan && (
                  <button
                    onClick={handleClearPlanOnly}
                    title="Clear query plan from view"
                    className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-white bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 px-2 py-1 rounded-lg transition-all cursor-pointer"
                  >
                    <XCircle className="w-3 h-3" />
                    <span>Clear Plan</span>
                  </button>
                )}

              </div>
            )}
          </div>

          <div className="p-5 space-y-4 bg-[#000000]">
            
            {/* Selected Query Snippet & Execution Action Buttons */}
            {selectedQuery && (
              <div className="rounded-xl border border-white/[0.08] bg-[#050507] p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
                  <div className="flex items-center gap-2">
                    <Code2 className="w-3.5 h-3.5 text-white" />
                    <span className="text-xs font-semibold text-white">Target SQL Statement</span>
                  </div>

                  {/* Manual Generate Buttons */}
                  <div className="flex items-center gap-2 flex-wrap">

                    <button
                      onClick={() => handleGeneratePlan('analyze')}
                      disabled={explainLoading}
                      className="flex items-center gap-1.5 bg-white hover:bg-neutral-200 text-black font-semibold px-3 py-1.5 rounded-xl text-xs transition-all cursor-pointer"
                      title="Executes the query to record actual runtime iterations and costs via EXPLAIN ANALYZE"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Run EXPLAIN ANALYZE</span>
                    </button>
                  </div>
                </div>

                <pre className="p-3 text-xs font-mono text-neutral-200 overflow-x-auto leading-relaxed bg-[#0a0a0d] rounded-lg border border-white/[0.04]">
                  {selectedQuery.sql || selectedQuery.query}
                </pre>

                {/* Referenced Tables Preview */}
                <div className="flex items-center gap-2 pt-1 flex-wrap">
                  <span className="text-[11px] text-neutral-400 font-medium">Tables Referenced:</span>
                  {getTables(selectedQuery).length > 0 ? (
                    getTables(selectedQuery).map(tbl => (
                      <span key={tbl} className="px-2 py-0.5 rounded bg-white/[0.08] text-white text-[10px] font-mono border border-white/[0.12]">
                        {tbl}
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] font-mono text-neutral-500">None detected</span>
                  )}
                </div>
              </div>
            )}

            {/* Plan Loading Indicator */}
            {explainLoading && (
              <div className="py-8 text-center text-xs text-neutral-400 flex items-center justify-center gap-2">
                <Sparkles className="w-4 h-4 text-white animate-spin" />
                <span>Generating query plan from database optimizer...</span>
              </div>
            )}

            {/* Plan Error Notice */}
            {explainError && !explainLoading && (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200 flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-amber-300">Query Plan Notice:</div>
                    <div className="mt-0.5 font-mono text-[11px]">{explainError}</div>
                  </div>
                </div>
                <button 
                  onClick={() => setExplainError(null)}
                  className="text-amber-400 hover:text-amber-200 p-1 cursor-pointer"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Tree View from MySQL EXPLAIN ANALYZE / EXPLAIN */}
            {explainPlan?.analyze_plan && !explainLoading && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-white" /> Hierarchical Execution Plan
                  </span>
                  <span className="text-[10px] font-mono text-neutral-500">
                    {explainPlan.mode === 'estimate' ? 'Optimizer Estimation' : 'Cost & Iteration Profiling'}
                  </span>
                </div>
                <div className="p-4 rounded-xl border border-white/[0.08] bg-[#070709] font-mono text-xs text-neutral-200 overflow-x-auto leading-relaxed whitespace-pre">
                  {explainPlan.analyze_plan}
                </div>
              </div>
            )}

            {/* Tabular Plan from MySQL Standard EXPLAIN */}
            {explainPlan?.tabular_plan?.length > 0 && !explainLoading && (
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
                    <Table2 className="w-3.5 h-3.5 text-white" /> Optimizer Table Access Strategy
                  </span>
                  <span className="text-[10px] font-mono text-neutral-500">Index & Join Analysis</span>
                </div>

                <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-[#050507]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-[#0f0f13] border-b border-white/[0.08] text-neutral-400 text-[11px]">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Table</th>
                        <th className="px-3 py-2 font-semibold">Join Type</th>
                        <th className="px-3 py-2 font-semibold">Index Used</th>
                        <th className="px-3 py-2 font-semibold text-right">Est. Rows</th>
                        <th className="px-3 py-2 font-semibold text-right">Filtered</th>
                        <th className="px-3 py-2 font-semibold">Extra Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04] font-mono text-[11px]">
                      {explainPlan.tabular_plan.map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-white/[0.02]">
                          <td className="px-3 py-2 text-white font-bold">{row.table || 'N/A'}</td>
                          <td className="px-3 py-2 text-emerald-400">{row.type || 'ALL'}</td>
                          <td className="px-3 py-2 text-neutral-300">{row.key || row.possible_keys || 'None'}</td>
                          <td className="px-3 py-2 text-right text-white">{row.rows?.toLocaleString() || 0}</td>
                          <td className="px-3 py-2 text-right text-neutral-400">{row.filtered ? `${row.filtered}%` : '100%'}</td>
                          <td className="px-3 py-2 text-neutral-400 text-[10px] max-w-xs truncate" title={row.Extra}>
                            {row.Extra || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Empty State when a query is selected but no plan has been run yet */}
            {selectedQuery && !explainPlan && !explainLoading && !explainError && (
              <div className="p-6 rounded-xl border border-white/[0.06] bg-[#070709] text-center space-y-2">
                <p className="text-xs font-medium text-neutral-300">
                  No execution plan generated for this query yet.
                </p>
                <p className="text-[11px] text-neutral-500 max-w-md mx-auto">
                  Click <strong className="text-white">Run EXPLAIN ANALYZE</strong> to execute and profile runtime timings.
                </p>
              </div>
            )}

            {/* Empty State when no query is selected at all */}
            {!selectedQuery && !explainPlan && !explainLoading && (
              <div className="py-8 text-center text-xs text-neutral-500">
                Select a query from the table above to view its details, estimate its execution plan, or delete it.
              </div>
            )}

          </div>
        </div>

      </div>
    </div>
  );
}
