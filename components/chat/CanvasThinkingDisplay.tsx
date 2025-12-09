
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDownIcon, LightBulbIcon } from '@heroicons/react/24/outline';

interface CanvasThinkingDisplayProps {
    thinking: string;
    isTyping?: boolean;
}

export const CanvasThinkingDisplay: React.FC<CanvasThinkingDisplayProps> = ({ thinking, isTyping }) => {
    // Closed by default as requested
    const [isOpen, setIsOpen] = useState(false);
    const isBuffering = thinking === '';

    return (
        <div className="mb-3 max-w-2xl">
             <button
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all w-full md:w-auto border ${isOpen ? 'bg-white/5 border-white/10 text-white' : 'bg-transparent border-transparent text-gray-500 hover:text-gray-300'}`}
                title="View reasoning process"
            >
                <div className={`flex items-center justify-center w-4 h-4 ${isTyping ? 'animate-pulse text-primary-start' : 'text-gray-500'}`}>
                    <LightBulbIcon className="w-4 h-4" />
                </div>
                
                <span className="flex-1 text-left">
                    {isTyping ? 'Thinking Process' : 'Reasoning'}
                </span>
                
                <ChevronDownIcon className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div 
                        initial={{ opacity: 0, height: 0 }} 
                        animate={{ opacity: 1, height: 'auto' }} 
                        exit={{ opacity: 0, height: 0 }} 
                        className="overflow-hidden"
                    >
                        <div className="mt-2 text-xs text-gray-300 font-mono whitespace-pre-wrap leading-relaxed bg-black/20 border-l-2 border-primary-start/50 pl-4 py-3 pr-4 rounded-r-lg">
                            {isBuffering ? (
                                <span className="text-gray-500 italic">Formulating thoughts...</span>
                            ) : thinking}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
