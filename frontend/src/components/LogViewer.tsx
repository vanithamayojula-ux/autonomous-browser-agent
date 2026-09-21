'use client';

import React from 'react';
import { Terminal, CheckCircle2, AlertCircle, Loader2, Image as ImageIcon } from 'lucide-react';

export interface StepLog {
  stepIndex: number;
  totalSteps: number;
  action: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  detail: string;
  screenshotBase64?: string;
  timestamp: string;
}

interface LogViewerProps {
  logs: StepLog[];
  isExecuting: boolean;
  onViewScreenshot?: (base64: string) => void;
}

export const LogViewer: React.FC<LogViewerProps> = ({ logs, isExecuting, onViewScreenshot }) => {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
      <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Terminal className="w-5 h-5 text-indigo-400" />
          <span className="font-semibold text-sm tracking-wide text-slate-200">Execution Logs Terminal</span>
        </div>
        {isExecuting && (
          <div className="flex items-center space-x-2 text-xs text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Agent Active</span>
          </div>
        )}
      </div>

      <div className="p-4 font-mono text-xs max-h-96 overflow-y-auto space-y-2.5 bg-slate-950/50">
        {logs.length === 0 ? (
          <div className="text-slate-500 italic text-center py-8">
            No active execution logs. Enter an objective and click &quot;Run Agent&quot;.
          </div>
        ) : (
          logs.map((log, idx) => (
            <div
              key={idx}
              className="flex items-start justify-between bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80 hover:border-slate-700 transition"
            >
              <div className="flex items-start space-x-3">
                {log.status === 'RUNNING' && <Loader2 className="w-4 h-4 text-amber-400 animate-spin mt-0.5" />}
                {log.status === 'SUCCESS' && <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5" />}
                {log.status === 'FAILED' && <AlertCircle className="w-4 h-4 text-rose-400 mt-0.5" />}
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-slate-400 font-semibold">[{log.stepIndex}/{log.totalSteps}]</span>
                    <span className="uppercase px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-bold">
                      {log.action}
                    </span>
                    <span className="text-slate-500 text-[10px]">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-slate-300 mt-1">{log.detail}</p>
                </div>
              </div>

              {log.screenshotBase64 && onViewScreenshot && (
                <button
                  onClick={() => onViewScreenshot(log.screenshotBase64!)}
                  className="flex items-center space-x-1 bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded text-[11px] transition ml-2 shrink-0"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>Snapshot</span>
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
