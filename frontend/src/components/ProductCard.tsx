'use client';

import React, { useState } from 'react';
import { ExternalLink, ShoppingBag, Star, Check, Copy } from 'lucide-react';

export interface ProductItem {
  title: string;
  image?: string;
  link: string;
  price?: string;
  rating?: string;
  specs?: string[];
  description?: string;
}

interface ProductCardProps {
  item: ProductItem;
  index: number;
}

export const ProductCard: React.FC<ProductCardProps> = ({ item, index }) => {
  const [copied, setCopied] = useState(false);
  const [imgSrc, setImgSrc] = useState(
    item.image || 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=500&auto=format&fit=crop'
  );

  const handleCopyLink = () => {
    navigator.clipboard.writeText(item.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fallbackImage = 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=500&auto=format&fit=crop';

  return (
    <div className="bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-indigo-500/50 rounded-2xl p-5 shadow-xl transition-all duration-300 flex flex-col md:flex-row gap-5 group relative overflow-hidden">
      {/* Product Image Section */}
      <div className="w-full md:w-52 h-44 bg-slate-950 rounded-xl overflow-hidden shrink-0 relative flex items-center justify-center border border-slate-800 group-hover:border-slate-700 transition">
        <img
          src={imgSrc}
          alt={item.title}
          onError={() => setImgSrc(fallbackImage)}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        <span className="absolute top-2.5 left-2.5 bg-slate-950/80 backdrop-blur-md text-indigo-400 text-[11px] font-bold px-2.5 py-1 rounded-lg border border-slate-800">
          #{index + 1}
        </span>
      </div>

      {/* Product Info Section */}
      <div className="flex-1 flex flex-col justify-between space-y-3">
        <div className="space-y-2">
          {/* Header & Rating */}
          <div className="flex items-start justify-between gap-3">
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="group-hover:text-indigo-300 transition"
            >
              <h3 className="font-bold text-base text-slate-100 group-hover:text-indigo-300 transition line-clamp-2 leading-snug">
                {item.title}
              </h3>
            </a>

            {item.rating && (
              <div className="flex items-center space-x-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2.5 py-1 rounded-lg text-xs font-semibold shrink-0">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                <span>{item.rating}</span>
              </div>
            )}
          </div>

          {/* Description */}
          {item.description && (
            <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
              {item.description}
            </p>
          )}

          {/* Key Specs Pills */}
          {item.specs && item.specs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {item.specs.map((spec, i) => (
                <span
                  key={i}
                  className="text-[11px] bg-slate-950 text-slate-300 px-2.5 py-1 rounded-md border border-slate-800 font-mono"
                >
                  {spec}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Price & Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
          <div>
            <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-500 block">
              {item.price ? 'Best Price' : 'Source Reference'}
            </span>
            <span className={`text-base font-extrabold tracking-tight ${item.price ? 'text-emerald-400 font-mono text-lg' : 'text-indigo-400'}`}>
              {item.price || 'Verified Web Link'}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleCopyLink}
              className="p-2.5 text-slate-400 hover:text-slate-200 bg-slate-950 hover:bg-slate-800 rounded-xl border border-slate-800 transition"
              title="Copy Link"
            >
              {copied ? (
                <Check className="w-4 h-4 text-emerald-400" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>

            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center space-x-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-semibold text-xs px-4 py-2.5 rounded-xl shadow-lg shadow-indigo-600/20 transition active:scale-[0.98]"
            >
              <ShoppingBag className="w-4 h-4" />
              <span>{item.price ? 'Buy Now' : 'Visit Webpage'}</span>
              <ExternalLink className="w-3.5 h-3.5 opacity-80" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
