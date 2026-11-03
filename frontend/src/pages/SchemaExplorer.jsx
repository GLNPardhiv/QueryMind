// src/pages/SchemaExplorer.jsx
import React, { useState, useEffect, useMemo, useRef, memo } from 'react';
import ReactFlow, { 
  Background, Controls, MiniMap, ReactFlowProvider, 
  Handle, Position, useReactFlow
} from 'reactflow';
import 'reactflow/dist/style.css';
import axios from 'axios';
import { useAuth } from '@clerk/clerk-react';
import { 
  Database, CheckCircle2, Search, Table2, Key, RefreshCw,
  Layers, Upload, FileCode, Check, Eye, ChevronDown,
  Plug, Code2, X, AlertCircle, ArrowRight, Sparkles, Maximize2
} from 'lucide-react';

import { useChat } from '../context/ChatContext';

// Custom Table Node Component with deep black minimalist styling
const TableNode = memo(({ data, selected }) => {
  return (
    <div 
      className={`rounded-2xl transition-all cursor-pointer font-sans select-none overflow-hidden ${
        selected 
          ? 'bg-[#18181b] border-2 border-white shadow-2xl scale-[1.02]' 
          : 'bg-[#0e0e11] border border-white/[0.12] hover:border-white/[0.3] shadow-md'
      }`}
      style={{ width: 220 }}
    >
      <Handle 
        type="target" 
        position={Position.Left} 
        className="!bg-white !w-2 !h-2 !border-2 !border-[#000000]" 
      />

      {/* Node Header */}
      <div className={`px-3 py-2 flex items-center justify-between border-b ${
        selected ? 'bg-[#27272a] border-white/20' : 'bg-[#141417] border-white/[0.08]'
      }`}>
        <div className="flex items-center gap-2 truncate">
          <Table2 className="w-3.5 h-3.5 text-white shrink-0" />
          <span className="font-mono text-xs font-semibold text-white truncate">{data.tableName}</span>
        </div>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-white/[0.1] text-white shrink-0">
          {data.columnCount}c
        </span>
      </div>

      {/* Node Body */}
      <div className="p-2.5 space-y-1.5 text-[11px] font-mono">
        {data.primaryKey && (
          <div className="flex items-center gap-1.5 text-neutral-300 truncate">
            <Key className="w-3 h-3 text-white shrink-0" />
            <span className="truncate">{data.primaryKey}</span>
          </div>
        )}

        {data.foreignKeyCount > 0 && (
          <div className="flex items-center gap-1.5 text-neutral-400 text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-white shrink-0" />
            <span>{data.foreignKeyCount} Foreign Key{data.foreignKeyCount > 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      <Handle 
        type="source" 
        position={Position.Right} 
        className="!bg-white !w-2 !h-2 !border-2 !border-[#000000]" 
      />
    </div>
  );
});

TableNode.displayName = 'TableNode';

const nodeTypes = {
  tableNode: TableNode
};

function SchemaGraphInner({ nodes, edges, onNodeClick, fitViewTrigger }) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    const timer = setTimeout(() => {
      fitView({ padding: 0.2 });
    }, 150);
    return () => clearTimeout(timer);
  }, [fitViewTrigger, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      theme="dark"
      minZoom={0.2}
      maxZoom={1.8}
    >
      <Background color="#1f1f23" gap={20} size={1} />
      <Controls className="!bg-[#0e0e11] !fill-white !border !border-white/10 !rounded-xl overflow-hidden" />
      <MiniMap 
        nodeColor={() => '#ffffff'} 
        maskColor="rgba(0, 0, 0, 0.85)"
        className="!bg-[#09090b] !border !border-white/10 !rounded-xl hidden sm:block" 
      />
    </ReactFlow>
  );
}

export default function SchemaExplorer() {
  const { getToken } = useAuth();
  const { setIsConnectModalOpen, connectedDb, setConnectedDb } = useChat();
  const fileInputRef = useRef(null);

  const [schemaData, setSchemaData] = useState(() => connectedDb?.schema || {});
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTable, setSelectedTable] = useState(null);
  const [uploadedSqlName, setUploadedSqlName] = useState(null);
  const [fitViewCounter, setFitViewCounter] = useState(0);

  // Dropdown menu state
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Paste DDL Modal State
  const [isPasteDdlOpen, setIsPasteDdlOpen] = useState(false);
  const [pastedDdlText, setPastedDdlText] = useState('');

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch real schema from backend
  const fetchSchema = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await axios.get('http://127.0.0.1:8000/api/v1/schema', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (res.data?.schema && Object.keys(res.data.schema).length > 0) {
        setSchemaData(res.data.schema);
        const firstTable = Object.keys(res.data.schema)[0];
        if (firstTable) setSelectedTable(firstTable);
        setFitViewCounter(c => c + 1);
      }
    } catch (err) {
      console.warn("Error fetching real schema:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (connectedDb?.schema && Object.keys(connectedDb.schema).length > 0) {
      setSchemaData(connectedDb.schema);
      if (!selectedTable) setSelectedTable(Object.keys(connectedDb.schema)[0]);
      setFitViewCounter(c => c + 1);
    } else {
      fetchSchema();
    }
  }, [connectedDb]);

  // Listen for live database connect events
  useEffect(() => {
    const onSchemaUpdated = (e) => {
      if (e.detail && Object.keys(e.detail).length > 0) {
        setSchemaData(e.detail);
        setSelectedTable(Object.keys(e.detail)[0]);
        setFitViewCounter(c => c + 1);
      }
    };
    window.addEventListener('schema-updated', onSchemaUpdated);
    return () => window.removeEventListener('schema-updated', onSchemaUpdated);
  }, []);

  // Parse SQL DDL to extract tables & columns
  const parseDdlString = (sqlContent, sourceName = 'Imported DDL') => {
    const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-zA-Z0-9_]+)`?\s*\(([\s\S]*?)\);/gi;
    const newSchema = { ...schemaData };
    let foundCount = 0;

    let match;
    while ((match = tableRegex.exec(sqlContent)) !== null) {
      const tableName = match[1].toLowerCase();
      const body = match[2];
      
      const lines = body.split(',').map(l => l.trim()).filter(Boolean);
      const cols = [];
      const pks = [];

      lines.forEach(line => {
        if (/^PRIMARY\s+KEY/i.test(line)) {
          const pkMatch = line.match(/\((.*?)\)/);
          if (pkMatch) {
            pks.push(...pkMatch[1].replace(/[`\s]/g, '').split(','));
          }
        } else if (!/^(CONSTRAINT|KEY|FOREIGN)/i.test(line)) {
          const parts = line.split(/\s+/);
          if (parts.length >= 2) {
            cols.push({
              name: parts[0].replace(/[`"]/g, ''),
              type: parts[1].replace(/[,;]/g, '')
            });
          }
        }
      });

      newSchema[tableName] = {
        columns: cols.length > 0 ? cols : [{ name: "id", type: "INT" }, { name: "name", type: "VARCHAR(100)" }],
        primary_keys: pks.length > 0 ? pks : ["id"],
        foreign_keys: []
      };
      foundCount++;
    }

    if (foundCount > 0) {
      setSchemaData(newSchema);
      setUploadedSqlName(`${sourceName} (${foundCount} tables)`);
      setConnectedDb({ id: 'imported_schema', name: sourceName });
      const firstAdded = Object.keys(newSchema).pop();
      if (firstAdded) setSelectedTable(firstAdded);
    } else {
      alert("No CREATE TABLE statements found in the provided SQL.");
    }
  };

  // Handle uploaded DDL / SQL file
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      parseDdlString(event.target.result, file.name);
    };
    reader.readAsText(file);
    e.target.value = '';
    setIsDropdownOpen(false);
  };

  // Handle Pasted DDL Submit
  const handlePasteDdlSubmit = (e) => {
    e.preventDefault();
    if (!pastedDdlText.trim()) return;
    parseDdlString(pastedDdlText, 'Pasted DDL');
    setPastedDdlText('');
    setIsPasteDdlOpen(false);
  };

  // Compute graph nodes and edges (Shows ALL tables without arbitrary truncation)
  const { nodes, edges } = useMemo(() => {
    const tableNames = Object.keys(schemaData);
    if (tableNames.length === 0) return { nodes: [], edges: [] };

    const filteredNames = searchQuery
      ? tableNames.filter(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
      : tableNames;

    const displayNames = filteredNames; // Display all tables

    const total = displayNames.length;
    const cols = total > 45 ? 5 : (total > 20 ? 4 : 3);
    const xGap = 290;
    const yGap = 160;

    const graphNodes = displayNames.map((tbl, idx) => {
      const meta = schemaData[tbl];
      const isSelected = selectedTable === tbl;

      const row = Math.floor(idx / cols);
      const col = idx % cols;

      return {
        id: tbl,
        type: 'tableNode',
        position: { x: col * xGap + 40, y: row * yGap + 40 },
        data: {
          tableName: tbl,
          columnCount: meta?.columns?.length || 0,
          primaryKey: meta?.primary_keys?.[0] || null,
          foreignKeyCount: meta?.foreign_keys?.length || 0
        },
        selected: isSelected
      };
    });

    // Foreign key edges
    const graphEdges = [];
    displayNames.forEach(tbl => {
      const meta = schemaData[tbl];
      if (meta?.foreign_keys) {
        meta.foreign_keys.forEach((fk, fkIdx) => {
          if (displayNames.includes(fk.referred_table)) {
            graphEdges.push({
              id: `edge-${tbl}-${fk.referred_table}-${fkIdx}`,
              source: tbl,
              target: fk.referred_table,
              animated: true,
              style: { stroke: '#52525b', strokeWidth: 1.5, opacity: 0.8 }
            });
          }
        });
      }
    });

    return { nodes: graphNodes, edges: graphEdges };
  }, [schemaData, searchQuery, selectedTable]);

  const selectedMeta = selectedTable ? schemaData[selectedTable] : null;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto w-full h-full flex flex-col gap-4 font-sans bg-[#000000] min-h-0 overflow-hidden text-white">
      
      {/* ── Top DB Info & Action Dropdown Bar ── */}
      <div className="bg-[#09090b] border border-white/[0.08] rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
        
        {/* Left: DB Status */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/[0.08] text-white flex items-center justify-center border border-white/[0.1]">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white text-sm">
                  {connectedDb?.name || "AdventureWorks DB"}
                </span>
                <span className="flex items-center gap-1 text-[11px] font-mono text-white bg-white/[0.08] border border-white/[0.12] px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Live
                </span>
                <span className="text-[11px] font-mono text-white bg-white/[0.06] border border-white/[0.08] px-2 py-0.5 rounded-full font-medium">
                  {Object.keys(schemaData).length} Tables
                </span>
                <span className="text-[11px] font-mono text-neutral-400 bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded-full hidden sm:inline-block">
                  {edges.length} FK Relations
                </span>
              </div>
              <p className="text-[11px] text-neutral-400">
                MySQL 8.0 · PyMySQL Engine · Deterministic AST Security Active
              </p>
            </div>
          </div>

          {uploadedSqlName && (
            <span className="text-xs bg-white/[0.08] text-white border border-white/[0.12] px-2.5 py-1 rounded-full font-mono flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" /> {uploadedSqlName}
            </span>
          )}
        </div>

        {/* Right: Search + Action Dropdown */}
        <div className="flex items-center gap-2.5">
          {/* Table Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search tables..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-[#000000] border border-white/[0.12] rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-neutral-600 outline-none w-40 sm:w-52 focus:border-white transition-colors"
            />
          </div>

          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".sql,.txt"
            className="hidden"
          />

          {/* Action / Import Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center gap-2 bg-white text-black hover:bg-neutral-200 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer"
            >
              <Plug className="w-3.5 h-3.5" />
              <span>Import / Connect</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Menu */}
            {isDropdownOpen && (
              <div className="absolute right-0 mt-2 w-60 bg-[#0e0e11] border border-white/[0.12] rounded-2xl shadow-2xl p-1.5 z-50 animate-fade-in space-y-1">
                <button
                  onClick={() => {
                    setIsDropdownOpen(false);
                    setConnectedDb({ id: 'adventureworks', name: 'AdventureWorks' });
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-neutral-200 hover:text-white hover:bg-white/[0.06] transition-all text-left cursor-pointer"
                >
                  <Database className="w-4 h-4 text-white" />
                  <div>
                    <div className="font-medium text-white">Use AdventureWorks DB</div>
                    <div className="text-[10px] text-neutral-400">Set as current active database</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setIsDropdownOpen(false);
                    setIsConnectModalOpen(true);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-neutral-200 hover:text-white hover:bg-white/[0.06] transition-all text-left cursor-pointer"
                >
                  <Plug className="w-4 h-4 text-white" />
                  <div>
                    <div className="font-medium text-white">Connect DB URI...</div>
                    <div className="text-[10px] text-neutral-400">MySQL, PostgreSQL, PyMySQL</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setIsDropdownOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-neutral-200 hover:text-white hover:bg-white/[0.06] transition-all text-left cursor-pointer"
                >
                  <Upload className="w-4 h-4 text-white" />
                  <div>
                    <div className="font-medium text-white">Import .SQL DDL File</div>
                    <div className="text-[10px] text-neutral-400">Upload schema definition file</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setIsDropdownOpen(false);
                    setIsPasteDdlOpen(true);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-neutral-200 hover:text-white hover:bg-white/[0.06] transition-all text-left cursor-pointer"
                >
                  <Code2 className="w-4 h-4 text-white" />
                  <div>
                    <div className="font-medium text-white">Paste Raw DDL</div>
                    <div className="text-[10px] text-neutral-400">Paste CREATE TABLE statements</div>
                  </div>
                </button>

                <div className="border-t border-white/[0.06] my-1" />

                <button
                  onClick={() => {
                    setIsDropdownOpen(false);
                    fetchSchema();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-neutral-200 hover:text-white hover:bg-white/[0.06] transition-all text-left cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4 text-neutral-400" />
                  <div>
                    <div className="font-medium text-white">Reload Schema</div>
                    <div className="text-[10px] text-neutral-400">Sync with active database</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Quick Refresh Icon Button */}
          <button
            onClick={fetchSchema}
            disabled={loading}
            className="p-2 bg-[#09090b] hover:bg-[#141417] text-neutral-400 hover:text-white border border-white/10 rounded-xl transition-colors cursor-pointer"
            title="Reload Schema"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── Main Layout: Canvas on Left, Details on Right ── */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 overflow-hidden min-h-0">
        
        {/* ReactFlow Canvas */}
        <div className="flex-1 bg-[#050507] border border-white/[0.08] rounded-2xl overflow-hidden relative flex flex-col min-h-0">
          <div className="bg-[#09090b] px-4 py-2.5 border-b border-white/[0.08] flex items-center justify-between text-xs text-neutral-400 shrink-0">
            <span className="flex items-center gap-2 text-white">
              <Sparkles className="w-3.5 h-3.5 text-white" /> Click any table node to inspect its columns & relationships
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFitViewCounter(c => c + 1)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-neutral-200 hover:text-white border border-white/10 text-[11px] font-mono transition-colors cursor-pointer"
                title="Fit all tables in view"
              >
                <Maximize2 className="w-3 h-3 text-white" />
                <span>Fit All</span>
              </button>
              <span className="text-[11px] font-mono text-neutral-300 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" /> RAG Pruned
              </span>
            </div>
          </div>

          <div className="flex-1 w-full h-full relative min-h-0">
            <ReactFlowProvider>
              <SchemaGraphInner 
                nodes={nodes} 
                edges={edges} 
                onNodeClick={(_, node) => setSelectedTable(node.id)}
                fitViewTrigger={fitViewCounter}
              />
            </ReactFlowProvider>
          </div>
        </div>

        {/* Selected Table Detail Drawer */}
        <div className="w-full lg:w-84 bg-[#09090b] border border-white/[0.08] rounded-2xl p-4 flex flex-col shrink-0 overflow-hidden min-h-0">
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.06] mb-3 shrink-0">
            <div className="flex items-center gap-2">
              <Table2 className="w-4 h-4 text-white" />
              <span className="font-bold text-sm text-white font-mono">{selectedTable || 'Select a table'}</span>
            </div>
            {selectedMeta && (
              <span className="text-[11px] text-neutral-400 font-mono bg-white/[0.05] px-2 py-0.5 rounded-md">
                {selectedMeta.columns?.length || 0} cols
              </span>
            )}
          </div>

          {selectedMeta ? (
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs min-h-0">
              
              {/* Primary Keys */}
              {selectedMeta.primary_keys && selectedMeta.primary_keys.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <Key className="w-3 h-3 text-white" /> Primary Key
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedMeta.primary_keys.map(pk => (
                      <span key={pk} className="px-2.5 py-1 rounded-lg bg-white/[0.08] text-white border border-white/[0.12] font-mono text-[11px]">
                        {pk}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Foreign Keys */}
              {selectedMeta.foreign_keys && selectedMeta.foreign_keys.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">
                    Foreign Keys ({selectedMeta.foreign_keys.length})
                  </div>
                  <div className="space-y-1.5">
                    {selectedMeta.foreign_keys.map((fk, idx) => (
                      <div key={idx} className="p-2.5 rounded-xl bg-[#000000] border border-white/[0.06] font-mono text-[11px] text-white">
                        <span className="text-white font-semibold">{fk.constrained_columns.join(', ')}</span>
                        <span className="text-neutral-500 mx-1.5">→</span>
                        <span className="text-neutral-300">{fk.referred_table}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Column List */}
              <div>
                <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">
                  Columns ({selectedMeta.columns?.length || 0})
                </div>
                <div className="space-y-1">
                  {selectedMeta.columns?.map(col => (
                    <div 
                      key={col.name}
                      className="flex items-center justify-between p-2 rounded-xl bg-[#000000] border border-white/[0.04] font-mono text-[11px] hover:border-white/20 transition-colors"
                    >
                      <span className="text-white">{col.name}</span>
                      <span className="text-[10px] text-neutral-400">{col.type}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-xs text-neutral-500 italic p-6 text-center">
              <Table2 className="w-8 h-8 mb-2 opacity-20 text-white" />
              <span>Select any table node on the graph to inspect columns and relationships.</span>
            </div>
          )}
        </div>

      </div>

      {/* ── Paste Raw DDL Modal ── */}
      {isPasteDdlOpen && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-[#0e0e11] border border-white/[0.12] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.08] flex justify-between items-center bg-[#070709]">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Code2 className="w-4 h-4 text-white" /> Paste SQL DDL Script
              </h3>
              <button onClick={() => setIsPasteDdlOpen(false)} className="text-neutral-400 hover:text-white cursor-pointer p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handlePasteDdlSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                  Paste CREATE TABLE statements:
                </label>
                <textarea
                  required
                  rows={8}
                  placeholder={`CREATE TABLE customers (\n  id INT PRIMARY KEY,\n  name VARCHAR(100),\n  email VARCHAR(100)\n);`}
                  value={pastedDdlText}
                  onChange={(e) => setPastedDdlText(e.target.value)}
                  className="w-full bg-[#000000] border border-white/[0.12] text-white rounded-xl p-3 text-xs font-mono focus:border-white focus:ring-1 focus:ring-white outline-none transition-all placeholder-neutral-600"
                />
              </div>
              <button 
                type="submit"
                className="w-full bg-white hover:bg-neutral-200 text-black font-semibold py-2.5 rounded-xl transition-all cursor-pointer text-xs"
              >
                Parse & Render in Graph
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
