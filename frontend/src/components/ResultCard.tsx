'use client';

import React, { useState } from 'react';
import { ExternalLink, Copy, Check, Globe } from 'lucide-react';

export interface SearchResultItem {
  title: string;
  link: string;
  snippet: string;
}

interface ResultCardProps {
  item: SearchResultItem;
  index: number;
}

export const ResultCard: React.FC<ResultCardProps> = ({ item, index }) => {
  const [copied, setCopied] = useState(false);

  const getDomain = (urlStr: string) => {
    try {
      const parsed = new URL(urlStr);
      return parsed.hostname.replace('www.', '');
    } catch {
      return 'web';
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(item.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-slate-900 hover:bg-slate-880 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 shadow-xl transition-all space-y-3 group">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-bold">
            {index + 1}
          </span>
          <span className="flex items-center space-x-1.5 text-[11px] font-mono text-slate-400 bg-slate-950 px-2.5 py-1 rounded-full border border-slate-800">
            <Globe className="w-3 h-3 text-sky-400" />
            <span>{getDomain(item.link)}</span>
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleCopyLink}
            className="flex items-center space-x-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-950 hover:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-800 transition"
            title="Copy Link to Clipboard"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-medium">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Link</span>
              </>
            )}
          </button>

          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center space-x-1.5 text-xs text-indigo-400 hover:text-indigo-300 bg-indigo-600/10 hover:bg-indigo-600/20 px-3 py-1.5 rounded-lg border border-indigo-500/20 transition font-medium"
          >
            <span>Open Link</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
      >
        <h3 className="text-base font-semibold text-slate-100 group-hover:text-indigo-300 transition leading-snug">
          {item.title}
        </h3>
      </a>

      <p className="text-xs text-slate-300 leading-relaxed font-normal">
        {item.snippet || 'No description preview available.'}
      </p>

      <div className="pt-1">
        <span className="text-[11px] font-mono text-slate-500 truncate block">
          {item.link}
        </span>
      </div>
    </div>
  );
};
