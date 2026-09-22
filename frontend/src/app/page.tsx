// Autonomous Web Search Assistant Tool - v1.1.0 (Rich Product Card System)
'use client';

import React, { useState } from 'react';
import { Search, Loader2, Sparkles, AlertCircle, Link as LinkIcon, SearchCheck, Bot, User, Copy, Check, ShoppingBag } from 'lucide-react';
import { ProductCard, ProductItem } from '../components/ProductCard';
import { ExecutionTimeline } from '../components/ExecutionTimeline';

export default function Home() {
  const [query, setQuery] = useState('');
  const [backendUrl, setBackendUrl] = useState(
    process.env.NEXT_PUBLIC_BACKEND_URL || 'https://autonomous-browser-agent.onrender.com'
  );
  const [isExecuting, setIsExecuting] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [executedQuery, setExecutedQuery] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleRunTask = async (queryToRun?: string) => {
    const targetQuery = (queryToRun || query).trim();
    if (!targetQuery) return;

    if (queryToRun) setQuery(queryToRun);

    setIsExecuting(true);
    setError(null);
    setProducts([]);
    setSummary(null);
    setSteps(['Initializing browser automation & product extraction engine...']);

    const baseUrl = backendUrl.trim().replace(/\/+$/, '');

    try {
      let response = await fetch(`${baseUrl}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: targetQuery }),
      });

      if (response.status === 404) {
        response = await fetch(`${baseUrl}/run-task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ objective: targetQuery }),
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server status ${response.status}: ${errorText || response.statusText}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Execution failed');
      }

      const formattedSteps = data.steps || (data.logs ? data.logs.map((l: { detail?: string; action?: string }) => l.detail || l.action || 'Executing step...') : [
        'Navigated to search engine',
        'Extracted structured product data',
        'Synthesized AI chat response'
      ]);

      setSteps(formattedSteps);
      setProducts(data.products || []);
      setSummary(data.summary || data.answer || null);
      setExecutedQuery(data.query || targetQuery);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('Failed to fetch')) {
        setError(`Failed to fetch results from backend at "${baseUrl}". Ensure backend service is online and CORS is enabled.`);
      } else {
        setError(msg);
      }
    } finally {
      setIsExecuting(false);
    }
  };

  const handleCopyAnswer = () => {
    if (!summary) return;
    navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-600/20 text-indigo-400 rounded-xl border border-indigo-500/30">
              <SearchCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight bg-gradient-to-r from-indigo-400 via-sky-300 to-emerald-400 bg-clip-text text-transparent">
                Search Assistant AI
              </h1>
              <p className="text-xs text-slate-400">Autonomous Web Search & Rich Product Extraction Engine</p>
            </div>
          </div>

          <div className="flex items-center space-x-2 text-xs text-slate-400 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Agent Engine Ready</span>
          </div>
        </div>
      </header>

      {/* Main Content Dashboard */}
      <div className="max-w-4xl mx-auto px-6 py-8 flex-1 w-full space-y-8">
        
        {/* INPUT SECTION */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
          {/* Backend Service URL Settings */}
          <div className="space-y-1.5">
            <label htmlFor="backendUrl" className="text-xs font-semibold text-slate-400 flex items-center space-x-1.5">
              <LinkIcon className="w-3.5 h-3.5 text-indigo-400" />
              <span>Backend API Service URL</span>
            </label>
            <input
              id="backendUrl"
              name="backendUrl"
              type="text"
              value={backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
              placeholder="https://autonomous-browser-agent.onrender.com"
              disabled={isExecuting}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono transition"
            />
          </div>

          {/* Main Search Input */}
          <div className="space-y-2">
            <label htmlFor="query" className="text-sm font-semibold text-slate-200 flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <span>Ask Search Assistant</span>
            </label>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
                <input
                  id="query"
                  name="query"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRunTask()}
                  placeholder="e.g. best laptops under 70000"
                  disabled={isExecuting}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
                />
              </div>
              <button
                onClick={() => handleRunTask()}
                disabled={isExecuting || !query.trim()}
                className="flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-xl shadow-lg shadow-indigo-600/25 transition active:scale-[0.98] shrink-0"
              >
                {isExecuting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Searching Products...</span>
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    <span>Search Products</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Sample Query Chips */}
          <div className="pt-2">
            <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Preset Search Prompts</h4>
            <div className="flex flex-wrap gap-2">
              {[
                'best laptops under 70000',
                'best backend projects for beginners 2026',
                'Node.js Express Playwright starter template'
              ].map((sample, i) => (
                <button
                  key={i}
                  onClick={() => handleRunTask(sample)}
                  disabled={isExecuting}
                  className="text-xs bg-slate-950 hover:bg-slate-800 text-slate-300 px-3.5 py-1.5 rounded-lg border border-slate-800 transition"
                >
                  &quot;{sample}&quot;
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Error Alert */}
        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 p-4 rounded-2xl text-xs flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block mb-0.5">Execution Failed</span>
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* EXECUTION TIMELINE */}
        <ExecutionTimeline steps={steps} isExecuting={isExecuting} />

        {/* RESULTS SECTION */}
        {executedQuery && (
          <section className="space-y-8 pt-4">
            
            {/* 1. User Message Bubble */}
            <div className="flex justify-end">
              <div className="flex items-start space-x-3 max-w-2xl">
                <div className="bg-indigo-600 text-white p-4 rounded-2xl rounded-tr-none shadow-lg space-y-1">
                  <div className="flex items-center space-x-2 text-[11px] font-semibold opacity-80">
                    <User className="w-3.5 h-3.5" />
                    <span>You</span>
                  </div>
                  <p className="text-sm text-white font-medium">{executedQuery}</p>
                </div>
              </div>
            </div>

            {/* 2. AI Assistant Response Message Bubble */}
            {summary && (
              <div className="flex justify-start">
                <div className="flex items-start space-x-3 max-w-3xl w-full">
                  <div className="p-2.5 bg-gradient-to-br from-indigo-500/20 to-sky-500/20 text-indigo-400 rounded-2xl border border-indigo-500/30 shrink-0 mt-1 shadow-md">
                    <Bot className="w-6 h-6" />
                  </div>

                  <div className="flex-1 bg-slate-900 border border-slate-800 rounded-3xl rounded-tl-none p-6 shadow-2xl space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-sm bg-gradient-to-r from-indigo-300 via-sky-200 to-emerald-300 bg-clip-text text-transparent">
                          Search Assistant AI
                        </span>
                        <span className="text-[10px] text-slate-400 bg-slate-950 px-2 py-0.5 rounded-full border border-slate-800">
                          AI Chat Overview
                        </span>
                      </div>

                      <button
                        onClick={handleCopyAnswer}
                        className="flex items-center space-x-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-950 hover:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-800 transition"
                        title="Copy Answer to Clipboard"
                      >
                        {copied ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400 font-medium">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy Answer</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="text-sm text-slate-200 leading-relaxed font-sans whitespace-pre-line space-y-3">
                      {summary}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 3. RICH PRODUCT CARDS SECTION */}
            {products.length > 0 && (
              <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                    <ShoppingBag className="w-4 h-4 text-emerald-400" />
                    <span>Top Recommended Products</span>
                  </h3>
                  <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full">
                    {products.length} Products Found
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-5">
                  {products.map((item, idx) => (
                    <ProductCard key={idx} item={item} index={idx} />
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
