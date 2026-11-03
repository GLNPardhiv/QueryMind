// src/pages/LandingPage.jsx
import React, { useState, useEffect } from 'react';
import { SignInButton, SignUpButton } from '@clerk/clerk-react';
import { 
  Database, ShieldCheck, Zap, Network, ChevronRight, Terminal, 
  Globe, Mail, MessageSquare, Code2, LineChart, Search,
  Server, ArrowRight, CheckCircle2, Sparkles, Lock
} from 'lucide-react';

// --- Minimalist Deep Black Code & Query Engine Preview ---
const LoopingCodeVideo = () => {
  const [step, setStep] = useState(0);
  const [typedText, setTypedText] = useState('');
  const [sqlLines, setSqlLines] = useState([]);
  
  const query = "Get top 3 customers by revenue";
  const finalSql = [
    "SELECT c.name, SUM(o.total) AS revenue",
    "FROM customers c",
    "JOIN orders o ON c.id = o.customer_id",
    "GROUP BY c.id",
    "ORDER BY revenue DESC LIMIT 3;"
  ];

  useEffect(() => {
    let timeout;
    let interval;
    
    if (step === 0) {
      setTypedText('');
      setSqlLines([]);
      let i = 0;
      interval = setInterval(() => {
        if (i <= query.length) {
          setTypedText(query.substring(0, i));
          i++;
        } else {
          clearInterval(interval);
          timeout = setTimeout(() => setStep(1), 700);
        }
      }, 45);
    } else if (step === 1) {
      let currentLine = 0;
      interval = setInterval(() => {
        if (currentLine < finalSql.length) {
          currentLine++;
          setSqlLines(finalSql.slice(0, currentLine));
        } else {
          clearInterval(interval);
          timeout = setTimeout(() => setStep(2), 900);
        }
      }, 260);
    } else if (step === 2) {
      timeout = setTimeout(() => setStep(0), 4500);
    }
    
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [step]);

  return (
    <div className="relative group">
      {/* Floating Micro-Badge */}
      <div className="hidden sm:flex absolute -top-3 -right-3 z-30 items-center gap-1.5 px-3 py-1 rounded-full bg-[#121215] border border-white/[0.15] shadow-xl text-[11px] font-mono text-white">
        <Sparkles className="w-3.5 h-3.5 text-white" />
        <span>AST Verified • 12ms</span>
      </div>

      {/* Main Glass Window Container */}
      <div className="relative bg-[#09090b] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden flex flex-col min-h-[380px] lg:min-h-[420px]">
        
        {/* Top Window Bar */}
        <div className="bg-[#121215] px-4 py-3 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-neutral-600" />
            <div className="w-2.5 h-2.5 rounded-full bg-neutral-600" />
            <div className="w-2.5 h-2.5 rounded-full bg-neutral-600" />
            <span className="ml-3 text-xs font-mono text-neutral-400 flex items-center gap-1.5">
              <Code2 className="w-3.5 h-3.5 text-white" /> querymind-engine.sql
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-[11px] font-mono text-neutral-400">Live Engine</span>
          </div>
        </div>
        
        {/* Card Body */}
        <div className="p-5 sm:p-6 font-mono text-xs sm:text-sm flex-1 flex flex-col">
          {/* Simulated User Input Bar */}
          <div className="flex items-center gap-3 text-white mb-5 bg-[#000000] px-4 py-3 rounded-xl border border-white/[0.1]">
            <Search className="w-4 h-4 text-neutral-400 shrink-0" />
            <span className="text-white font-sans tracking-wide truncate">
              {typedText}
              {step === 0 && <span className="animate-pulse text-white font-mono font-bold">|</span>}
            </span>
            {step === 0 && (
              <span className="ml-auto text-[10px] uppercase tracking-wider text-neutral-500 font-mono hidden sm:inline">
                Typing...
              </span>
            )}
          </div>

          {/* Generated SQL Section */}
          <div className="mb-4 flex-1">
            <div className="flex items-center justify-between mb-2.5 text-[11px] text-neutral-400 font-semibold tracking-wider">
              <span className="flex items-center gap-1.5 text-white">
                <Terminal className="w-3.5 h-3.5 text-white" /> GENERATED SQL (AST-SAFE)
              </span>
              {step >= 1 && (
                <span className="text-[10px] text-neutral-500 font-normal">Dialect: MySQL 8.0</span>
              )}
            </div>

            <div className="bg-[#000000] rounded-xl p-3.5 border border-white/[0.08] min-h-[140px] space-y-1">
              {sqlLines.length === 0 && step === 0 && (
                <div className="h-full flex items-center justify-center text-neutral-600 text-xs italic py-8">
                  Awaiting natural language prompt...
                </div>
              )}
              {sqlLines.map((line, idx) => {
                const safeLine = line || "";
                if (!safeLine) return null;
                
                return (
                  <div key={idx} className="text-neutral-300 leading-relaxed font-mono">
                    <span className="text-neutral-600 select-none mr-3 text-xs w-4 inline-block text-right">{idx + 1}</span>
                    {safeLine.replace(/(SELECT|FROM|JOIN|ON|GROUP BY|ORDER BY|DESC|LIMIT|AS|SUM)/g, match => `__MAGIC__${match}__MAGIC__`)
                         .split('__MAGIC__')
                         .map((part, i) => 
                            ["SELECT", "FROM", "JOIN", "ON", "GROUP BY", "ORDER BY", "DESC", "LIMIT", "AS", "SUM"].includes(part) 
                            ? <span key={i} className="text-white font-semibold">{part}</span> 
                            : part
                         )}
                  </div>
                );
              })}
              {step === 1 && (
                <div className="text-neutral-600 mt-1">
                  <span className="mr-3 text-xs w-4 inline-block text-right">{sqlLines.length + 1}</span>
                  <span className="animate-pulse text-white font-bold">_</span>
                </div>
              )}
            </div>
          </div>

          {/* Result Table Preview */}
          {step === 2 && (
            <div className="animate-fade-in border-t border-white/[0.08] pt-3.5">
              <div className="flex items-center justify-between mb-2 text-[11px] text-neutral-400 font-semibold tracking-wider">
                <span className="flex items-center gap-1.5 text-white">
                  <LineChart className="w-3.5 h-3.5 text-white" /> QUERY RESULTS
                </span>
                <span className="text-[10px] text-neutral-300 bg-white/[0.06] border border-white/[0.1] px-2 py-0.5 rounded-full">
                  3 rows in 14ms
                </span>
              </div>
              <div className="overflow-x-auto rounded-lg border border-white/[0.08] bg-[#000000]">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-neutral-400 border-b border-white/[0.08] bg-white/[0.02]">
                      <th className="py-1.5 px-3 font-semibold">name</th>
                      <th className="py-1.5 px-3 font-semibold text-right">revenue</th>
                    </tr>
                  </thead>
                  <tbody className="text-neutral-200 divide-y divide-white/[0.04]">
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-1.5 px-3 text-neutral-300">TechCorp Inc.</td>
                      <td className="py-1.5 px-3 font-mono text-white text-right">$142,500.00</td>
                    </tr>
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-1.5 px-3 text-neutral-300">Global Logistics</td>
                      <td className="py-1.5 px-3 font-mono text-white text-right">$98,200.00</td>
                    </tr>
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-1.5 px-3 text-neutral-300">Nexus Dynamics</td>
                      <td className="py-1.5 px-3 font-mono text-white text-right">$75,450.00</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#000000] text-white font-sans selection:bg-white selection:text-black flex flex-col relative overflow-hidden">
      
      {/* 1. Navbar */}
      <nav className="border-b border-white/[0.08] bg-[#000000]/90 backdrop-blur-xl fixed w-full z-50 top-0 transition-all">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white text-black flex items-center justify-center font-bold">
              <Database className="w-4 h-4" />
            </div>
            <span className="font-bold text-lg tracking-tight text-white">QueryMind</span>
          </div>
          
          <div className="flex items-center gap-6 text-xs sm:text-sm font-medium">
            <a href="#how-it-works" className="text-neutral-400 hover:text-white transition-colors hidden md:block">
              How it Works
            </a>
            <a href="#features" className="text-neutral-400 hover:text-white transition-colors hidden md:block">
              Security & RBAC
            </a>
            
            <SignInButton mode="modal">
              <button className="text-neutral-300 hover:text-white transition-colors cursor-pointer px-3 py-1.5">
                Sign In
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="bg-white hover:bg-neutral-200 text-black font-semibold px-4 py-2 rounded-full transition-all cursor-pointer text-xs">
                Get Started
              </button>
            </SignUpButton>
          </div>
        </div>
      </nav>

      <main className="flex-grow pt-16">
        
        {/* 2. Hero Section with Background Code Integration */}
        <section className="relative pt-16 pb-20 lg:pt-28 lg:pb-32 overflow-hidden">
          <div className="max-w-7xl mx-auto px-6 relative z-10">
            
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
              
              {/* Left Column: Headline, Value Proposition, and Action Buttons */}
              <div className="lg:col-span-6 xl:col-span-6 text-left">
                
                {/* Pill Badge */}
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#121215] border border-white/[0.12] text-neutral-300 text-xs font-medium mb-6">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>Enterprise Text-to-SQL Engine with AST Gate</span>
                </div>
                
                {/* Main Headline */}
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight mb-6 leading-[1.12]">
                  Talk to your database. <br />
                  <span className="text-neutral-400">
                    Without writing SQL.
                  </span>
                </h1>
                
                {/* Subtitle Description */}
                <p className="text-base sm:text-lg text-neutral-400 mb-8 max-w-xl leading-relaxed font-normal">
                  QueryMind translates complex natural language into verified SQL in real-time, guarded by deterministic AST static analysis and role-based cryptographic RBAC.
                </p>
                
                {/* Action CTA Buttons */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 mb-10">
                  <SignUpButton mode="modal">
                    <button className="bg-white hover:bg-neutral-200 text-black px-7 py-3.5 rounded-full font-semibold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm">
                      Start Querying Free <ArrowRight className="w-4 h-4" />
                    </button>
                  </SignUpButton>
                  
                  <a 
                    href="#how-it-works" 
                    className="px-7 py-3.5 rounded-full font-medium text-sm text-neutral-300 hover:text-white bg-[#0e0e11] hover:bg-[#18181b] transition-all border border-white/[0.12] text-center"
                  >
                    See How it Works
                  </a>
                </div>

                {/* Key Metric Highlights */}
                <div className="grid grid-cols-3 gap-4 pt-4 border-t border-white/[0.08] max-w-lg">
                  <div>
                    <div className="text-xl sm:text-2xl font-bold text-white tracking-tight font-mono">0 ms</div>
                    <div className="text-xs text-neutral-500 font-medium">AST Security Overhead</div>
                  </div>
                  <div>
                    <div className="text-xl sm:text-2xl font-bold text-white tracking-tight font-mono">70+</div>
                    <div className="text-xs text-neutral-500 font-medium">Live Tables Pruned</div>
                  </div>
                  <div>
                    <div className="text-xl sm:text-2xl font-bold text-white tracking-tight font-mono">100%</div>
                    <div className="text-xs text-neutral-500 font-medium">Read-Only Safety</div>
                  </div>
                </div>

              </div>

              {/* Right Column: Code Display Window */}
              <div className="lg:col-span-6 xl:col-span-6 relative lg:translate-x-2">
                <div className="relative">
                  <LoopingCodeVideo />
                </div>
              </div>

            </div>

          </div>
        </section>

        {/* 3. Social Proof / Supported Dialects */}
        <section className="border-y border-white/[0.08] bg-[#09090b] py-8">
          <div className="max-w-7xl mx-auto px-6 text-center">
            <p className="text-xs font-semibold text-neutral-500 uppercase tracking-widest mb-6">
              Connects seamlessly with enterprise relational & analytical warehouses
            </p>
            <div className="flex flex-wrap justify-center items-center gap-8 sm:gap-14 text-neutral-400">
              <div className="flex items-center gap-2 text-sm sm:text-base font-medium hover:text-white transition-colors">
                <Database className="w-4 h-4 text-white" /> MySQL 8.0
              </div>
              <div className="flex items-center gap-2 text-sm sm:text-base font-medium hover:text-white transition-colors">
                <Server className="w-4 h-4 text-white" /> PostgreSQL
              </div>
              <div className="flex items-center gap-2 text-sm sm:text-base font-medium hover:text-white transition-colors">
                <Network className="w-4 h-4 text-white" /> Snowflake
              </div>
              <div className="flex items-center gap-2 text-sm sm:text-base font-medium hover:text-white transition-colors">
                <Database className="w-4 h-4 text-white" /> Google BigQuery
              </div>
            </div>
          </div>
        </section>

        {/* 4. How It Works Section */}
        <section id="how-it-works" className="max-w-7xl mx-auto px-6 py-24 sm:py-32 relative">
          
          <div className="text-center mb-16 sm:mb-20">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.06] border border-white/[0.1] text-neutral-300 text-xs font-medium mb-4">
              Simple 3-Step Flow
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-4">
              From natural question to data in seconds
            </h2>
            <p className="text-neutral-400 max-w-2xl mx-auto text-sm sm:text-base">
              No SQL bottleneck or manual report waiting. QueryMind bridges raw schemas and non-technical business questions with strict safety.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
            {/* Step 1 */}
            <div className="bg-[#09090b] border border-white/[0.08] hover:border-white/[0.2] p-8 rounded-2xl transition-all shadow-xl group">
              <div className="w-10 h-10 bg-white text-black rounded-xl flex items-center justify-center mb-6 text-sm font-bold">
                1
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Connect Schema</h3>
              <p className="text-neutral-400 text-xs sm:text-sm leading-relaxed">
                Connect your database URI or import a DDL dump. QueryMind vectorizes tables, columns, and relations for semantic RAG search.
              </p>
            </div>
            
            {/* Step 2 */}
            <div className="bg-[#09090b] border border-white/[0.08] hover:border-white/[0.2] p-8 rounded-2xl transition-all shadow-xl group">
              <div className="w-10 h-10 bg-white text-black rounded-xl flex items-center justify-center mb-6 text-sm font-bold">
                2
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Ask in Plain English</h3>
              <p className="text-neutral-400 text-xs sm:text-sm leading-relaxed">
                Ask business questions. The hybrid engine vector-prunes the schema and generates dialect-tailored, optimized SQL.
              </p>
            </div>

            {/* Step 3 */}
            <div className="bg-[#09090b] border border-white/[0.08] hover:border-white/[0.2] p-8 rounded-2xl transition-all shadow-xl group">
              <div className="w-10 h-10 bg-white text-black rounded-xl flex items-center justify-center mb-6 text-sm font-bold">
                3
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Review & Run in Workbench</h3>
              <p className="text-neutral-400 text-xs sm:text-sm leading-relaxed">
                Queries pass through AST inspection to block mutations, letting you inspect and run queries in SQL Workbench when ready.
              </p>
            </div>
          </div>
        </section>

        {/* 5. Feature & RBAC Architecture Grid */}
        <section id="features" className="py-24 sm:py-32 border-t border-white/[0.08] bg-[#000000] relative">
          <div className="max-w-7xl mx-auto px-6">
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.06] border border-white/[0.1] text-neutral-300 text-xs font-medium mb-4">
                Security & Role Enforcement
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-4">
                Enterprise infrastructure built for security
              </h2>
              <p className="text-neutral-400 max-w-xl mx-auto text-sm sm:text-base">
                Engineered with multi-layered defenses to guarantee your raw data remains untouched and unmutated.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Feature 1 */}
              <div className="bg-[#09090b] border border-white/[0.08] hover:border-white/[0.2] p-8 rounded-2xl transition-all shadow-xl group">
                <div className="w-10 h-10 bg-white/[0.08] text-white rounded-xl flex items-center justify-center mb-6">
                  <Network className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">Hybrid RAG Pruning</h3>
                <p className="text-neutral-400 leading-relaxed text-xs sm:text-sm">
                  Dynamically prunes enterprise schemas down to exact relevant tables using ChromaDB semantic vector search and foreign-key graph traversal.
                </p>
              </div>
              
              {/* Feature 2 */}
              <div className="bg-[#09090b] border border-white/[0.08] hover:border-white/[0.2] p-8 rounded-2xl transition-all shadow-xl group">
                <div className="w-10 h-10 bg-white/[0.08] text-white rounded-xl flex items-center justify-center mb-6">
                  <ShieldCheck className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">Deterministic AST Security</h3>
                <p className="text-neutral-400 leading-relaxed text-xs sm:text-sm">
                  Every query is decomposed into an Abstract Syntax Tree via SQLGlot. Destructive operations (DROP, DELETE, UPDATE) and unauthorized tables are rejected instantly.
                </p>
              </div>

              {/* Feature 3: RBAC */}
              <div className="bg-[#09090b] border border-white/[0.08] hover:border-white/[0.2] p-8 rounded-2xl transition-all shadow-xl group">
                <div className="w-10 h-10 bg-white/[0.08] text-white rounded-xl flex items-center justify-center mb-6">
                  <Lock className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">Multi-Tier RBAC Verification</h3>
                <p className="text-neutral-400 leading-relaxed text-xs sm:text-sm">
                  Differentiates between <strong>ADMIN</strong> and <strong>STANDARD_USER</strong>. Standard users are restricted from connecting raw DB URIs and querying sensitive payroll or audit log tables.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 6. Call to Action */}
        <section className="max-w-7xl mx-auto px-6 py-20 sm:py-28 text-center relative">
          <div className="bg-[#09090b] border border-white/[0.1] rounded-3xl p-10 sm:p-16 overflow-hidden shadow-2xl">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight mb-4">
              Ready to unlock your database?
            </h2>
            <p className="text-neutral-400 text-sm sm:text-base mb-8 max-w-xl mx-auto leading-relaxed">
              Eliminate reporting delays and empower your entire team to discover data insights in real-time.
            </p>
            
            <SignUpButton mode="modal">
              <button className="bg-white hover:bg-neutral-200 text-black px-9 py-3.5 rounded-full font-semibold text-sm transition-all cursor-pointer">
                Create Free Account
              </button>
            </SignUpButton>
          </div>
        </section>

      </main>

      {/* 7. Footer */}
      <footer className="border-t border-white/[0.08] bg-[#000000] pt-14 pb-8">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 mb-14">
            <div className="col-span-2 lg:col-span-2">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-xl bg-white text-black flex items-center justify-center font-bold">
                  <Database className="w-4 h-4" />
                </div>
                <span className="font-bold text-lg tracking-tight text-white">QueryMind</span>
              </div>
              <p className="text-neutral-400 text-xs sm:text-sm max-w-sm mb-6 leading-relaxed">
                The secure natural language interface for modern relational and cloud data warehouses.
              </p>
              <div className="flex items-center gap-4 text-neutral-400">
                <a href="#" className="hover:text-white transition-colors"><Globe className="w-4 h-4" /></a>
                <a href="#" className="hover:text-white transition-colors"><MessageSquare className="w-4 h-4" /></a>
                <a href="#" className="hover:text-white transition-colors"><Mail className="w-4 h-4" /></a>
              </div>
            </div>

            <div>
              <h4 className="text-white font-semibold mb-4 text-xs tracking-wider uppercase">Product</h4>
              <ul className="space-y-2 text-xs sm:text-sm text-neutral-400">
                <li><a href="#" className="hover:text-white transition-colors">Workbench</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Schema Graph</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Security Engine</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Enterprise RBAC</a></li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-semibold mb-4 text-xs tracking-wider uppercase">Resources</h4>
              <ul className="space-y-2 text-xs sm:text-sm text-neutral-400">
                <li><a href="#" className="hover:text-white transition-colors">Documentation</a></li>
                <li><a href="#" className="hover:text-white transition-colors">API Reference</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Architecture Guide</a></li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-semibold mb-4 text-xs tracking-wider uppercase">Legal</h4>
              <ul className="space-y-2 text-xs sm:text-sm text-neutral-400">
                <li><a href="#" className="hover:text-white transition-colors">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Terms of Service</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Security Overview</a></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-white/[0.08] pt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-neutral-500">
            <p>© {new Date().getFullYear()} QueryMind Inc. All rights reserved.</p>
            <div className="flex items-center gap-2 px-3 py-1 bg-white/[0.06] border border-white/[0.1] rounded-full text-white">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>All systems operational</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
