'use client';

import React, { useState } from 'react';
import { Play, Square, Bot, Sparkles, FileText, CheckCircle, AlertTriangle } from 'lucide-react';
import { LogViewer, StepLog } from '../components/LogViewer';
import { ScreenshotModal } from '../components/ScreenshotModal';

export default function Home() {
  const [objective, setObjective] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<StepLog[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [activeScreenshot, setActiveScreenshot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

  const handleRunTask = async () => {
    if (!objective.trim()) return;

    setIsExecuting(true);
    setError(null);
    setSummary(null);
    setLogs([]);
    setStatusMessage('Connecting to backend agent...');

    try {
      const response = await fetch(`${BACKEND_URL}/api/agent/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Agent execution failed');
      }

      setLogs(data.logs || []);
      setSummary(data.summary || null);
      setStatusMessage('Execution completed successfully!');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-600/20 text-indigo-400 rounded-xl border border-indigo-500/30">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight bg-gradient-to-r from-indigo-400 via-sky-300 to-emerald-400 bg-clip-text text-transparent">
                Autonomous AI Browser Agent
              </h1>
              <p className="text-xs text-slate-400">Autonomous Web Automation Engine</p>
            </div>
          </div>
          <div className="flex items-center space-x-2 text-xs text-slate-400 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Engine Ready</span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-6 py-8 flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8 w-full">
        {/* Left Column: Input & Controls */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex items-center space-x-2 text-sm font-semibold text-slate-200">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <span>Define Task Objective</span>
            </div>

            <textarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="e.g. Go to Google, search for best backend projects for beginners 2026, extract results, and take a screenshot."
              disabled={isExecuting}
              className="w-full h-36 bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition resize-none"
            />

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={handleRunTask}
                disabled={isExecuting || !objective.trim()}
                className="w-full flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium px-5 py-2.5 rounded-xl shadow-lg shadow-indigo-600/25 transition active:scale-[0.98]"
              >
                {isExecuting ? (
                  <>
                    <Square className="w-4 h-4 animate-pulse fill-white" />
                    <span>Executing Task...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-white" />
                    <span>Run Task Agent</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Quick Examples */}
          <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-5 space-y-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Preset Sample Objectives</h3>
            <div className="space-y-2">
              {[
                'Search Google for top 3 beginner backend projects 2026 and extract titles.',
                'Go to GitHub, check trending repositories, and summarize top results.',
                'Open HackerNews homepage and extract top 5 technology stories.'
              ].map((sample, i) => (
                <button
                  key={i}
                  onClick={() => setObjective(sample)}
                  disabled={isExecuting}
                  className="w-full text-left text-xs bg-slate-900 hover:bg-slate-800 text-slate-300 p-2.5 rounded-lg border border-slate-800 transition"
                >
                  &quot;{sample}&quot;
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 p-4 rounded-xl text-xs flex items-start space-x-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block">Execution Error</span>
                <span>{error}</span>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Logs & Results */}
        <div className="lg:col-span-7 space-y-6">
          <LogViewer
            logs={logs}
            isExecuting={isExecuting}
            onViewScreenshot={(base64) => setActiveScreenshot(base64)}
          />

          {/* Final Summary Output */}
          {summary && (
            <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-6 shadow-2xl space-y-4 bg-gradient-to-b from-slate-900 to-slate-950">
              <div className="flex items-center space-x-2 text-emerald-400 text-sm font-semibold border-b border-slate-800 pb-3">
                <CheckCircle className="w-5 h-5" />
                <span>Agent Execution Summary</span>
              </div>
              <div className="prose prose-invert max-w-none text-xs leading-relaxed text-slate-300 space-y-2 whitespace-pre-wrap">
                {summary}
              </div>
            </div>
          )}
        </div>
      </div>

      <ScreenshotModal
        base64Image={activeScreenshot}
        onClose={() => setActiveScreenshot(null)}
      />
    </main>
  );
}
