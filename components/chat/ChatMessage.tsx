
import React, { useState } from 'react';
import { Message } from '../../types';
import { motion, AnimatePresence } from 'framer-motion';
import { CodeBlock } from '../ui/CodeBlock';
import { 
    CheckCircleIcon, LightBulbIcon, CodeBracketSquareIcon, ShareIcon as ShareIconSolid, SparklesIcon, HandThumbUpIcon as HandThumbUpSolid, HandThumbDownIcon as HandThumbDownSolid, EyeIcon, SpeakerWaveIcon, PauseIcon 
} from '@heroicons/react/24/solid';
import { 
    ChevronDownIcon, ClipboardDocumentCheckIcon, HandThumbUpIcon, HandThumbDownIcon, ArrowPathIcon, EllipsisHorizontalIcon, GlobeAltIcon, ArrowUpOnSquareIcon, BoltIcon, DocumentIcon, DocumentTextIcon, CommandLineIcon
} from '@heroicons/react/24/outline';
import { ClarificationForm } from './ClarificationForm';
import { MessageContent } from './MessageContent';
import { ImageModal } from '../modals/ImageModal';
import { MermaidDiagram } from './MermaidDiagram';
import { CanvasModal } from '../modals/CanvasModal';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { useToast } from '../../hooks/useToast';
import { CanvasThinkingDisplay } from './CanvasThinkingDisplay';
import { SearchStatus } from './SearchStatus';
import { useAuth } from '../../contexts/AuthContext';
import { generateSpeech } from '../../services/geminiService';

const parseMessageContent = (content: string) => {
    if (!content) return { thinking: null, canvas: null, searches: [], clean: '' };
    
    const thinkMatch = content.match(/<THINK>([\s\S]*?)(?:<\/THINK>|$)/i);
    const thinking = thinkMatch ? thinkMatch[1].trim() : null;
    
    // Extract ALL search tags
    const searchMatches = [...content.matchAll(/<SEARCH>([\s\S]*?)(?:<\/SEARCH>|$)/gi)];
    const searches = searchMatches.map(m => m[1].trim()).filter(Boolean);

    const canvasStart = content.search(/<CANVAS>/i);
    let canvas = null;
    if (canvasStart !== -1) {
        const afterStart = content.substring(canvasStart + 8); 
        const canvasEnd = afterStart.search(/<\/CANVAS>/i);
        if (canvasEnd !== -1) canvas = afterStart.substring(0, canvasEnd).trim();
        else canvas = afterStart.trim();
        if (canvas) canvas = canvas.replace(/^```\w*\n?/, '').replace(/```$/, '').trim();
    }
    
    let clean = content
        .replace(/<THINK>[\s\S]*?(?:<\/THINK>|$)/gi, '')
        .replace(/<CANVAS>[\s\S]*?(?:<\/CANVAS>|$)/gi, '')
        .replace(/<SEARCH>[\s\S]*?(?:<\/SEARCH>|$)/gi, '') // Remove search from main text
        .replace(/<MEMORY>[\s\S]*?<\/MEMORY>/gi, '')
        .replace(/<IMAGE>[\s\S]*?<\/IMAGE>/gi, '')
        .replace(/<PROJECT>[\s\S]*?<\/PROJECT>/gi, '')
        .replace(/<STUDY>[\s\S]*?<\/STUDY>/gi, '')
        .replace(/<DEEP>[\s\S]*?<\/DEEP>/gi, '')
        .trim();
        
    return { thinking, canvas, searches, clean };
};

const getModelDisplayName = (modelId?: string) => {
    if (!modelId) return "AI";
    if (modelId.includes('gemini-2.5-flash')) return "Gemini 2.5 Flash";
    if (modelId.includes('gemini-3-pro')) return "Gemini 3 Pro";
    if (modelId.includes('gemini-1.5-pro')) return "Gemini 1.5 Pro";
    const parts = modelId.split('/');
    const name = parts.length > 1 ? parts[1] : modelId;
    return name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

async function decodePCM16(base64Data: string, ctx: AudioContext): Promise<AudioBuffer> {
    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const int16Data = new Int16Array(bytes.buffer);
    const float32Data = new Float32Array(int16Data.length);
    for (let i = 0; i < int16Data.length; i++) {
        float32Data[i] = int16Data[i] / 32768.0;
    }
    const buffer = ctx.createBuffer(1, float32Data.length, 24000);
    buffer.copyToChannel(float32Data, 0);
    return buffer;
}

interface ChatMessageProps {
  message: Message;
  onExecutePlan: (messageId: string) => void;
  onClarificationSubmit: (messageId: string, answers: string[]) => void;
  onRetry?: (messageId: string, modelOverride?: string) => void;
  isDimmed?: boolean;
  isCurrentResult?: boolean;
  searchQuery?: string;
  isAdmin?: boolean;
  isTyping?: boolean;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ 
    message, onExecutePlan, onClarificationSubmit, onRetry, isDimmed = false, isCurrentResult = false, searchQuery = '', isAdmin = false, isTyping = false,
}) => {
  const { profile, geminiApiKey, isGuest } = useAuth();
  const { addToast } = useToast();
  const isUser = message.sender === 'user';
  const [showRaw, setShowRaw] = useState(false);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [isCanvasPreviewOpen, setIsCanvasPreviewOpen] = useState(false);
  const [canvasCodeForPreview, setCanvasCodeForPreview] = useState('');
  const [feedback, setFeedback] = useState<'none' | 'like' | 'dislike'>('none');
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isRegenMenuOpen, setIsRegenMenuOpen] = useState(false);
  const { isCopied, copy } = useCopyToClipboard(message.text);
  
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [audioSource, setAudioSource] = useState<AudioBufferSourceNode | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);

  const { thinking, canvas, searches, clean } = isUser ? { thinking: null, canvas: null, searches: [], clean: message.text } : parseMessageContent(message.text);
  
  // Use groundingMetadata if available (persistent), otherwise fall back to temporary search tag content
  const hasSources = message.groundingMetadata && Array.isArray(message.groundingMetadata) && message.groundingMetadata.length > 0;
  
  // Search State Logic:
  // Is searching if we have search tags AND we are either typing OR haven't produced the final clean text yet.
  // Once 'clean' text appears, we consider the search 'done' and showing results.
  const isSearching = (searches.length > 0 && isTyping) || (searches.length > 0 && !clean);

  // ... (handleLike, handleDislike, handleShare, handlePlayAudio logic remains the same) ...
  const handleLike = (e: React.MouseEvent) => { e.stopPropagation(); setFeedback(prev => prev === 'like' ? 'none' : 'like'); addToast('Thanks for the feedback!', 'success'); };
  const handleDislike = (e: React.MouseEvent) => { e.stopPropagation(); setFeedback(prev => prev === 'dislike' ? 'none' : 'dislike'); addToast('Thanks for the feedback!', 'success'); };
  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
        if (navigator.share) await navigator.share({ title: 'Bubble AI Response', text: message.text });
        else { await navigator.clipboard.writeText(message.text); addToast('Response copied', 'success'); }
    } catch (err) { await navigator.clipboard.writeText(message.text); addToast('Response copied', 'success'); }
  };

  const cleanupAudio = () => {
      if (audioSource) {
          try { audioSource.stop(); } catch(e) {}
          setAudioSource(null);
      }
      if (audioContextRef.current) {
          audioContextRef.current.close().catch(console.error);
          audioContextRef.current = null;
      }
      setIsPlayingAudio(false);
      setIsGeneratingAudio(false);
  };

  const handlePlayAudio = async () => {
      if (isGuest) return; 

      if (isPlayingAudio) {
          cleanupAudio();
          return;
      }

      if (!geminiApiKey) {
          addToast("API Key needed for TTS", "error");
          return;
      }

      setIsGeneratingAudio(true);
      try {
          const speechText = clean.substring(0, 1000); 
          const base64Audio = await generateSpeech(speechText, geminiApiKey);
          
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          const audioCtx = new AudioContextClass();
          audioContextRef.current = audioCtx;
          
          const audioBuffer = await decodePCM16(base64Audio, audioCtx);
          
          const source = audioCtx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioCtx.destination);
          
          source.onended = () => {
              cleanupAudio();
          };
          
          setIsPlayingAudio(true);
          source.start(0);
          setAudioSource(source);
      } catch (e) {
          console.error("Audio playback error", e);
          addToast("Unable to play audio.", "error");
          cleanupAudio();
      } finally {
          setIsGeneratingAudio(false);
      }
  };
  
  React.useEffect(() => {
      return () => {
          if (audioContextRef.current) {
              audioContextRef.current.close().catch(console.error);
          }
      };
  }, []);

  const handleManualPreview = (code: string) => {
      setCanvasCodeForPreview(code);
      setIsCanvasPreviewOpen(true);
  };

  const variants = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } };

  const availableModels = [
      { id: 'gemini_2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'gemini_3_pro_preview', name: 'Gemini 3 Pro' },
      ...(profile?.enabled_openrouter_models || []).map(m => ({ id: m, name: m.split('/')[1] || m }))
  ];

  if (isUser) {
    // ... (User message rendering) ...
    let attachments: any[] = [];
    if (message.image_base64) {
        try { 
            const parsed = JSON.parse(message.image_base64); 
            if (Array.isArray(parsed)) {
                if (typeof parsed[0] === 'string') {
                    attachments = parsed.map((b64, i) => ({ type: 'image/jpeg', data: b64, name: `Image ${i+1}` }));
                } else {
                    attachments = parsed;
                }
            } else {
                attachments = [{ type: 'image/jpeg', data: message.image_base64, name: 'Attachment' }];
            }
        } catch { 
            attachments = [{ type: 'image/jpeg', data: message.image_base64, name: 'Attachment' }]; 
        }
    }

    return (
        <motion.div variants={variants} initial="hidden" animate="visible" className={`flex justify-end mb-3 ${isDimmed ? 'opacity-30' : 'opacity-100'}`}>
            <div className={`bg-zinc-800 text-zinc-100 rounded-2xl px-4 py-3 max-w-[85%] sm:max-w-[70%] break-words shadow-md ${isCurrentResult ? 'ring-2 ring-yellow-400' : ''}`}>
                {attachments.length > 0 && (
                    <div className={`grid gap-2 mb-2 ${attachments.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                        {attachments.map((att, index) => {
                            const isImage = att.type.startsWith('image/');
                            return (
                                <div key={index} className="overflow-hidden rounded-lg border border-white/10 bg-black/20 group relative">
                                    {isImage && att.data ? (
                                        <img src={`data:${att.type};base64,${att.data}`} alt={att.name || "Upload"} className="w-full h-auto object-cover max-h-48" />
                                    ) : (
                                        <div className="flex items-center gap-3 p-3 transition-colors hover:bg-white/5">
                                            <div className="p-2 rounded-lg bg-gray-500/20"><DocumentIcon className="w-6 h-6 text-gray-400" /></div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium truncate text-white" title={att.name}>{att.name}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
                <MessageContent content={message.text} searchQuery={searchQuery} sender={message.sender} />
            </div>
        </motion.div>
    );
  }
  
  return (
    <motion.div variants={variants} initial="hidden" animate="visible" className={`flex items-start gap-4 transition-opacity duration-300 ${isDimmed ? 'opacity-30' : 'opacity-100'} max-w-full`}>
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-bg-secondary flex items-center justify-center border border-border-color"><span className="text-lg">🫧</span></div>
        <div className={`flex-1 min-w-0 ${isCurrentResult ? 'rounded-lg ring-2 ring-yellow-400' : ''}`}>
            
            {/* SEARCH UI - Perplexity Style */}
            {/* If searching, pass the active queries. If done, pass null query but provide sources. */}
            <SearchStatus 
                isSearching={isSearching} 
                query={isSearching ? searches : null} 
                sources={message.groundingMetadata} 
            />

            {/* THINKING UI */}
            {(thinking !== null) && (
                 <CanvasThinkingDisplay thinking={thinking || ''} isTyping={isTyping && !thinking && !isSearching} />
            )}

            <div className="w-full prose mt-1 max-w-full">
                {showRaw ? <pre className="p-4 text-xs bg-black/30 rounded-lg overflow-x-auto whitespace-pre-wrap">{JSON.stringify(message, null, 2)}</pre> : (
                    <>
                        {/* Render Main Content */}
                        {message.standing_response ? (
                            <MessageContent content={message.text} searchQuery={searchQuery || ''} sender={message.sender} isTyping={isTyping} />
                        ) : message.plan ? (
                             <MessageContent content={message.text} searchQuery={searchQuery || ''} sender={message.sender} isTyping={isTyping} />
                        ) : message.clarification ? (
                             <MessageContent content={message.text} searchQuery={searchQuery || ''} sender={message.sender} isTyping={isTyping} />
                        ) : (
                            <MessageContent content={clean} searchQuery={searchQuery} sender={message.sender} isTyping={isTyping} onPreviewHtml={handleManualPreview} />
                        )}

                        {canvas && (
                            <div className="my-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-xs font-bold text-primary-start uppercase tracking-wider">Canvas</span>
                                    <div className="h-px bg-white/10 flex-1"></div>
                                </div>
                                <CodeBlock 
                                    code={canvas} 
                                    language="html" 
                                    onPreview={() => {
                                        setCanvasCodeForPreview(canvas || '');
                                        setIsCanvasPreviewOpen(true);
                                    }} 
                                />
                            </div>
                        )}
                        
                        {message.image_base64 && (
                            <>
                                <div className="mt-4 not-prose">
                                    <button onClick={() => setIsImageModalOpen(true)} className="block w-full group"><img src={`data:image/png;base64,${message.image_base64}`} alt="Generated content" className="rounded-lg max-w-md mx-auto h-auto shadow-lg transition-transform duration-200 group-hover:scale-[1.02]" /></button>
                                </div>
                                <AnimatePresence>{isImageModalOpen && <ImageModal src={`data:image/png;base64,${message.image_base64}`} onClose={() => setIsImageModalOpen(false)} />}</AnimatePresence>
                            </>
                        )}
                        {message.code && !clean.includes('```') && <div className="not-prose max-w-full overflow-hidden"><CodeBlock code={message.code} language={message.language || 'lua'} /></div>}
                    </>
                )}
            </div>

            {/* Message Actions */}
            <div className="flex flex-wrap items-center gap-2 mt-3 pt-2 select-none not-prose relative">
                <button onClick={(e) => { e.stopPropagation(); copy(); }} className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-md" title="Copy"><ClipboardDocumentCheckIcon className="w-4 h-4" /></button>
                <button onClick={handleLike} className={`p-1.5 rounded-md ${feedback === 'like' ? 'text-green-400' : 'text-gray-400 hover:text-white'}`}><HandThumbUpIcon className="w-4 h-4" /></button>
                <button onClick={handleDislike} className={`p-1.5 rounded-md ${feedback === 'dislike' ? 'text-red-400' : 'text-gray-400 hover:text-white'}`}><HandThumbDownIcon className="w-4 h-4" /></button>
                
                {!isGuest && (
                    <>
                        <button onClick={handleShare} className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-md"><ArrowUpOnSquareIcon className="w-4 h-4" /></button>
                        <button 
                            onClick={(e) => { e.stopPropagation(); handlePlayAudio(); }} 
                            className={`p-1.5 rounded-md transition-colors ${isPlayingAudio ? 'text-primary-start bg-primary-start/10' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
                            title={isPlayingAudio ? "Stop" : "Listen"}
                            disabled={isGeneratingAudio}
                        >
                            {isGeneratingAudio ? (
                                <svg className="animate-spin h-4 w-4 text-primary-start" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                            ) : isPlayingAudio ? (
                                <PauseIcon className="w-4 h-4" />
                            ) : (
                                <SpeakerWaveIcon className="w-4 h-4" />
                            )}
                        </button>

                        {onRetry && (
                            <button 
                                onClick={(e) => { e.stopPropagation(); onRetry(message.id); }} 
                                className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-md"
                                title="Regenerate"
                            >
                                <ArrowPathIcon className="w-4 h-4" />
                            </button>
                        )}
                        
                        <div className="relative">
                            <button onClick={(e) => { e.stopPropagation(); setIsMoreOpen(!isMoreOpen); }} className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-md"><EllipsisHorizontalIcon className="w-4 h-4" /></button>
                            <AnimatePresence>
                                {isMoreOpen && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => { setIsMoreOpen(false); setIsRegenMenuOpen(false); }} />
                                        <motion.div 
                                            initial={{ opacity: 0, y: 5, scale: 0.95 }} 
                                            animate={{ opacity: 1, y: 0, scale: 1 }} 
                                            exit={{ opacity: 0, y: 5, scale: 0.95 }} 
                                            className="absolute left-0 bottom-full mb-2 bg-bg-tertiary border border-border-color rounded-lg shadow-xl z-20 w-48 overflow-hidden"
                                        >
                                            <div className="px-3 py-2 border-b border-white/5 bg-black/10">
                                                <p className="text-[10px] uppercase font-bold text-gray-500 tracking-wider mb-1">Generated By</p>
                                                <div className="flex items-center gap-1.5 text-xs text-gray-300">
                                                    <SparklesIcon className="w-3 h-3 text-primary-start" />
                                                    <span className="truncate">{getModelDisplayName(message.model)}</span>
                                                </div>
                                            </div>

                                            {onRetry && (
                                                <div className="relative">
                                                    <button 
                                                        onClick={() => setIsRegenMenuOpen(!isRegenMenuOpen)} 
                                                        className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-white/5 flex items-center justify-between"
                                                    >
                                                        <span className="flex items-center gap-2"><BoltIcon className="w-4 h-4"/> Regenerate with...</span>
                                                        <ChevronDownIcon className="w-3 h-3" />
                                                    </button>
                                                    {isRegenMenuOpen && (
                                                        <div className="bg-black/20 border-t border-white/5">
                                                            {availableModels.map(model => (
                                                                <button
                                                                    key={model.id}
                                                                    onClick={() => { onRetry(message.id, model.id); setIsMoreOpen(false); }}
                                                                    className="w-full text-left px-6 py-2 text-xs text-gray-400 hover:text-white hover:bg-white/5 truncate"
                                                                >
                                                                    {model.name}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            <button onClick={() => { setShowRaw(!showRaw); setIsMoreOpen(false); }} className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-white/5 flex items-center gap-2"><EyeIcon className="w-4 h-4" /> {showRaw ? "Hide Raw Data" : "View Raw Data"}</button>
                                        </motion.div>
                                    </>
                                )}
                            </AnimatePresence>
                        </div>
                    </>
                )}
            </div>
        </div>
        <AnimatePresence>{isCanvasPreviewOpen && <CanvasModal code={canvasCodeForPreview} onClose={() => setIsCanvasPreviewOpen(false)} />}</AnimatePresence>
    </motion.div>
  );
};
