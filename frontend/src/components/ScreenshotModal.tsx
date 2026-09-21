'use client';

import React from 'react';
import { X } from 'lucide-react';

interface ScreenshotModalProps {
  base64Image: string | null;
  onClose: () => void;
}

export const ScreenshotModal: React.FC<ScreenshotModalProps> = ({ base64Image, onClose }) => {
  if (!base64Image) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full p-4 overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
          <h3 className="text-sm font-semibold text-slate-200">Execution Snapshot Preview</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-auto rounded-lg border border-slate-950">
          <img
            src={`data:image/jpeg;base64,${base64Image}`}
            alt="Browser Step Screenshot"
            className="w-full h-auto object-contain"
          />
        </div>
      </div>
    </div>
  );
};
