'use client';

import React from 'react';
import { CheckCircle2, Loader2, ListChecks } from 'lucide-react';

interface ExecutionTimelineProps {
  steps: string[];
  isExecuting: boolean;
}

export const ExecutionTimeline: React.FC<ExecutionTimelineProps> = ({ steps, isExecuting }) => {
  if (steps.length === 0 && !isExecuting) return null;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center space-x-2">
          <ListChecks className="w-5 h-5 text-indigo-400" />
          <h3 className="text-sm font-semibold text-slate-200">Execution Timeline</h3>
        </div>
        {isExecuting && (
          <div className="flex items-center space-x-2 text-xs text-amber-400 bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Running Agent...</span>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {steps.map((stepText, idx) => (
          <div key={idx} className="flex items-center space-x-3 text-xs bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-slate-300 font-medium">{stepText}</span>
          </div>
        ))}

        {isExecuting && (
          <div className="flex items-center space-x-3 text-xs bg-slate-950/40 p-3 rounded-xl border border-slate-800/40 opacity-75">
            <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
            <span className="text-slate-400 italic">Processing current execution step...</span>
          </div>
        )}
      </div>
    </div>
  );
};
