
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GlobeAltIcon, ChevronDownIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

interface SearchStatusProps {
    isSearching: boolean;
    query?: string | string[] | null;
    sources?: Array<{ web: { uri: string; title: string } }>;
}

const getFaviconUrl = (url: string) => {
    try {
        const domain = new URL(url).hostname;
        return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch {
        return '';
    }
};

const getDomain = (url: string) => {
    try {
        return new URL(url).hostname.replace('www.', '');
    } catch {
        return url;
    }
};

export const SearchStatus: React.FC<SearchStatusProps> = ({ isSearching, query, sources }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [displayQuery, setDisplayQuery] = useState("");

    useEffect(() => {
        if (!isSearching) return;
        
        let queries = Array.isArray(query) ? query : [query || "info"];
        if (queries.length === 0) queries = ["info"];

        let index = 0;
        setDisplayQuery(queries[0]);

        if (queries.length > 1) {
            const interval = setInterval(() => {
                index = (index + 1) % queries.length;
                setDisplayQuery(queries[index]);
            }, 2000);
            return () => clearInterval(interval);
        }
    }, [isSearching, query]);

    if (isSearching) {
        return (
            <motion.div 
                initial={{ opacity: 0, y: 5 }} 
                animate={{ opacity: 1, y: 0 }}
                className="mb-4 flex items-center gap-3 p-3 bg-bg-secondary/50 rounded-lg border border-primary-start/20"
            >
                <div className="relative flex items-center justify-center w-5 h-5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-primary-start/30 animate-ping"></span>
                    <MagnifyingGlassIcon className="w-4 h-4 text-primary-start relative z-10" />
                </div>
                <AnimatePresence mode="wait">
                    <motion.span 
                        key={displayQuery}
                        initial={{ opacity: 0, x: 5 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -5 }}
                        className="text-sm text-gray-300 font-medium truncate max-w-[200px] md:max-w-md"
                    >
                        Searching for "{displayQuery}"...
                    </motion.span>
                </AnimatePresence>
            </motion.div>
        );
    }

    if (!sources || sources.length === 0) return null;

    // Deduplicate sources based on URL
    const uniqueSources = sources.filter((v, i, a) => a.findIndex(t => (t.web.uri === v.web.uri)) === i);
    const displaySources = isExpanded ? uniqueSources : uniqueSources.slice(0, 4);
    const hasMore = uniqueSources.length > 4;

    return (
        <div className="mb-6 not-prose">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-gray-400">
                    <GlobeAltIcon className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">Sources</span>
                </div>
                <button 
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors"
                >
                    {uniqueSources.length} Found
                    <ChevronDownIcon className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <AnimatePresence initial={false}>
                    {displaySources.map((source, idx) => (
                        <motion.a
                            key={idx}
                            href={source.web.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="flex items-center gap-2 p-2 bg-bg-tertiary/50 hover:bg-bg-tertiary border border-white/5 hover:border-white/10 rounded-lg transition-all group overflow-hidden"
                            title={source.web.title}
                        >
                            <img 
                                src={getFaviconUrl(source.web.uri)} 
                                alt="" 
                                className="w-4 h-4 rounded-sm flex-shrink-0 opacity-70 group-hover:opacity-100"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} 
                            />
                            <div className="flex flex-col min-w-0">
                                <span className="text-xs text-gray-300 font-medium truncate group-hover:text-primary-start">
                                    {source.web.title || getDomain(source.web.uri)}
                                </span>
                                <span className="text-[10px] text-gray-500 truncate">
                                    {getDomain(source.web.uri)}
                                </span>
                            </div>
                        </motion.a>
                    ))}
                </AnimatePresence>
                {!isExpanded && hasMore && (
                    <button 
                        onClick={() => setIsExpanded(true)}
                        className="flex items-center justify-center gap-1 p-2 bg-bg-tertiary/30 hover:bg-bg-tertiary border border-white/5 rounded-lg text-xs text-gray-400 hover:text-white transition-colors"
                    >
                        +{uniqueSources.length - 4} more
                    </button>
                )}
            </div>
        </div>
    );
};
