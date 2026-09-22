// Autonomous Web Search Assistant Tool - v1.0.2 (Multi-Engine Pipeline)
'use client';

import React, { useState } from 'react';
import { Search, Loader2, Sparkles, AlertCircle, Link as LinkIcon, SearchCheck } from 'lucide-react';
import { ResultCard, SearchResultItem } from '../components/ResultCard';
import { ExecutionTimeline } from '../components/ExecutionTimeline';

export default function Home() {
  const [query, setQuery] = useState('');
  const [backendUrl, setBackendUrl] = useState(
    process.env.NEXT_PUBLIC_BACKEND_URL || 'https://autonomous-browser-agent.onrender.com'
  );
  const [isExecuting, setIsExecuting] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [executedQuery, setExecutedQuery] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRunTask = async (queryToRun?: string) => {
    const targetQuery = (queryToRun || query).trim();
    if (!targetQuery) return;

    if (queryToRun) setQuery(queryToRun);

    setIsExecuting(true);
    setError(null);
    setResults([]);
    setSteps(['Initializing browser automation engine...']);

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

      // Convert backend logs into human-readable timeline steps if string steps array isn't provided directly
      const formattedSteps = data.steps || (data.logs ? data.logs.map((l: { detail?: string; action?: string }) => l.detail || l.action || 'Executing step...') : [
        'Navigated to search engine',
        'Extracted top organic search results',
        'Synthesized result cards'
      ]);

      setSteps(formattedSteps);
      setResults(data.results || []);
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

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-600/20 text-indigo-400 rounded-xl border border-indigo-500/30">
              <SearchCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight bg-gradient-to-r from-indigo-400 via-sky-300 to-emerald-400 bg-clip-text text-transparent">
                Search Assistant Tool
              </h1>
              <p className="text-xs text-slate-400">Autonomous Web Search & Extraction Engine</p>
            </div>
          </div>

          <div className="flex items-center space-x-2 text-xs text-slate-400 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Agent Engine Ready</span>
          </div>
        </div>
      </header>

      {/* Main Content Dashboard */}
      <div className="max-w-6xl mx-auto px-6 py-8 flex-1 w-full space-y-8">
        
        {/* SECTION A: INPUT SECTION */}
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
              <span>Enter Search Query</span>
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
                  placeholder="e.g. best laptops under 50000"
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
                    <span>Running Agent...</span>
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    <span>Run Search Agent</span>
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
                'best laptops under 50000',
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

        {/* SECTION B: EXECUTION TIMELINE */}
        <ExecutionTimeline steps={steps} isExecuting={isExecuting} />

        {/* SECTION C: RESULTS SECTION */}
        {executedQuery && (
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-base font-bold text-slate-100 flex items-center space-x-2">
                <span>Search Results for</span>
                <span className="text-indigo-400">&quot;{executedQuery}&quot;</span>
              </h2>
              <span className="text-xs text-slate-400 bg-slate-900 border border-slate-800 px-3 py-1 rounded-full">
                {results.length} Top Items Extracted
              </span>
            </div>

            {results.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-xs text-slate-400 space-y-2">
                <p>No results found for this search query.</p>
                <p className="text-slate-500">Try rephrasing your search query or selecting a preset prompt.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {results.map((item, idx) => (
                  <ResultCard key={idx} item={item} index={idx} />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
