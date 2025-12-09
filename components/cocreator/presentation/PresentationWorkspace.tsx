
import React, { useMemo, useState } from 'react';
import Split from 'react-split-grid';
import { IdeWorkspaceProps } from '../shared/IdeWorkspace';
import { ChatView } from '../../chat/ChatView';
import { useWindowSize } from '../../../hooks/useWindowSize';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/solid';

// Enhanced markdown-to-html for presentation slides
const renderSlideContent = (markdown: string) => {
    let html = markdown
        .replace(/^# (.*$)/gim, '<h1 class="text-4xl md:text-5xl font-bold mb-6 text-center text-white">$1</h1>')
        .replace(/^## (.*$)/gim, '<h2 class="text-2xl md:text-3xl font-semibold mb-4 text-primary-start">$1</h2>')
        .replace(/^\* (.*$)/gim, '<li class="ml-6 list-disc mb-2 text-xl text-gray-200">$1</li>')
        .replace(/^- (.*$)/gim, '<li class="ml-6 list-disc mb-2 text-xl text-gray-200">$1</li>')
        .replace(/`([^`]+)`/g, '<code class="bg-black/30 text-primary-start px-1.5 py-0.5 rounded font-mono">$1</code>')
        .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>')
        .replace(/\*(.*?)\*/g, '<em class="text-gray-300">$1</em>')
        .replace(/\n/g, '<br />');

    // Wrap list items in a ul if strictly sequential
    if (html.includes('<li')) {
        // Simple regex replace isn't perfect for nested lists but works for flat slides
        html = html.replace(/(<li.*<\/li>)/g, '<ul class="w-full max-w-2xl mx-auto">$1</ul>');
        // Remove duplicate ul tags if regex matched individual lines
        html = html.replace(/<\/ul><ul[^>]*>/g, '');
    }

    return { __html: html };
};

export const PresentationWorkspace: React.FC<IdeWorkspaceProps> = (props) => {
    const { messages } = props;
    const { width } = useWindowSize();
    const isMobile = width ? width < 1024 : false;
    const [selectedSlide, setSelectedSlide] = useState(0);

    const slides = useMemo(() => {
        // Look for the most recent message with 'code' (where we stored the slides)
        // OR fallback to the latest AI text message if it contains separators
        const latestCodeMessage = [...messages].reverse().find(m => m.sender === 'ai' && (m.code || m.text.includes('---')));
        
        if (!latestCodeMessage) return [];
        
        const content = latestCodeMessage.code || latestCodeMessage.text;
        // Slides are separated by '---'
        const rawSlides = content.split(/^---$/m).map(s => s.trim()).filter(Boolean);
        
        return rawSlides;
    }, [messages]);
    
    // Auto-select first slide if available and none selected
    if (slides.length > 0 && selectedSlide >= slides.length) {
        setSelectedSlide(0);
    }

    const nextSlide = () => setSelectedSlide(prev => Math.min(prev + 1, slides.length - 1));
    const prevSlide = () => setSelectedSlide(prev => Math.max(prev - 1, 0));
    
    const slideView = (
        <div className="h-full overflow-hidden flex flex-col md:flex-row bg-bg-primary">
            {slides.length > 0 ? (
                <>
                    {/* Thumbnail Sidebar */}
                    <div className="w-full md:w-56 flex-shrink-0 bg-bg-secondary p-3 overflow-x-auto md:overflow-y-auto border-b md:border-b-0 md:border-r border-border-color flex md:flex-col gap-3">
                        {slides.map((slide, index) => (
                            <div
                                key={index}
                                onClick={() => setSelectedSlide(index)}
                                className={`flex-shrink-0 w-40 md:w-full aspect-video p-2 border-2 rounded-lg cursor-pointer bg-bg-primary transition-all duration-200 group relative ${selectedSlide === index ? 'border-primary-start shadow-lg shadow-primary-start/10 ring-1 ring-primary-start' : 'border-transparent hover:border-white/20'}`}
                            >
                                <div className="absolute top-1 left-2 text-[10px] font-bold text-gray-500 group-hover:text-gray-300">
                                    {index + 1}
                                </div>
                                <div
                                    className="w-full h-full flex flex-col justify-center items-center text-[4px] leading-tight overflow-hidden opacity-50 select-none pointer-events-none"
                                >
                                    {/* Mini preview text */}
                                    {slide.substring(0, 100)}...
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Main Slide View */}
                    <div className="flex-1 relative flex flex-col items-center justify-center bg-gray-900/50 p-4 md:p-12 overflow-hidden">
                        
                        {/* Slide Container */}
                        <div className="w-full max-w-5xl aspect-video bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl shadow-2xl border border-white/5 flex flex-col relative overflow-hidden">
                            {/* Slide Content */}
                            <div 
                                className="flex-1 p-8 md:p-16 flex flex-col justify-center items-center text-center overflow-y-auto"
                                dangerouslySetInnerHTML={renderSlideContent(slides[selectedSlide] || '')}
                            />
                            
                            {/* Slide Footer */}
                            <div className="h-8 bg-black/20 flex items-center justify-between px-6 text-xs text-gray-500">
                                <span>Bubble Presentation</span>
                                <span>{selectedSlide + 1} / {slides.length}</span>
                            </div>
                        </div>

                        {/* Navigation Controls */}
                        <div className="absolute bottom-6 flex items-center gap-4 bg-black/40 backdrop-blur-md p-2 rounded-full border border-white/10">
                            <button 
                                onClick={prevSlide} 
                                disabled={selectedSlide === 0}
                                className="p-2 hover:bg-white/10 rounded-full disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-white"
                            >
                                <ChevronLeftIcon className="w-6 h-6" />
                            </button>
                            <span className="text-sm font-medium text-gray-300 px-2">
                                Slide {selectedSlide + 1}
                            </span>
                            <button 
                                onClick={nextSlide} 
                                disabled={selectedSlide === slides.length - 1}
                                className="p-2 hover:bg-white/10 rounded-full disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-white"
                            >
                                <ChevronRightIcon className="w-6 h-6" />
                            </button>
                        </div>

                    </div>
                </>
            ) : (
                <div className="flex items-center justify-center h-full w-full text-gray-500 text-center p-8">
                    <div>
                        <h3 className="text-xl font-semibold text-gray-300 mb-2">Presentation Builder</h3>
                        <p>Ask the AI to generate slides to see them here.</p>
                        <p className="text-xs mt-4 text-gray-600">Try: "Create a 5-slide pitch deck for a coffee shop"</p>
                    </div>
                </div>
            )}
        </div>
    );
    
    if (isMobile) {
        return <ChatView {...props} />;
    }

    return (
        <div className="h-full w-full bg-transparent text-white">
            <Split gridTemplateColumns="minmax(350px, 1fr) 8px 2fr" minSize={300} cursor="col-resize">
                {(split: any) => (
                     <div className="grid h-full w-full bg-bg-primary" {...split.getGridProps()}>
                        <div className="h-full bg-bg-secondary overflow-hidden">
                            <ChatView {...props} />
                        </div>
                        <div className="h-full bg-bg-tertiary cursor-col-resize" {...split.getGutterProps('column', 1)} />
                        <div className="h-full overflow-hidden">
                           {slideView}
                        </div>
                    </div>
                )}
            </Split>
        </div>
    );
};
