
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeftOnRectangleIcon, CheckCircleIcon, KeyIcon, UserCircleIcon, CreditCardIcon, PaintBrushIcon,
    CurrencyDollarIcon, WrenchScrewdriverIcon, BoltIcon, GlobeAltIcon, DocumentMagnifyingGlassIcon, SpeakerWaveIcon, CpuChipIcon
} from '@heroicons/react/24/solid';
import { useAuth } from '../../contexts/AuthContext';
import { validateApiKey } from '../../services/geminiService';
import { validateOpenRouterKey } from '../../services/openRouterService';
import { MemoryDashboard } from '../settings/MemoryDashboard';
import { BillingSettings } from '../settings/BillingSettings';
import { ModelPreferences } from '../settings/ModelPreferences';
import { useToast } from '../../hooks/useToast';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { ApiKeySetupPage } from '../auth/ApiKeySetupPage';

type SettingsTab = 'profile' | 'account' | 'appearance' | 'memory' | 'apiKeys' | 'billing' | 'models' | 'audio';

const FALLBACK_AVATAR_SVG = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23334155'/%3E%3Cpath d='M50 42 C61.046 42 70 50.954 70 62 L30 62 C30 50.954 38.954 42 50 42 Z' fill='white'/%3E%3Ccircle cx='50' cy='30' r='10' fill='white'/%3E%3C/svg%3E`;

const Section: React.FC<{ title: string; children: React.ReactNode; description?: string }> = ({ title, children, description }) => (
    <div className="max-w-4xl mx-auto">
        <h2 className="text-3xl font-bold text-text-primary">{title}</h2>
        <div className="w-24 border-b-2 border-primary-start mt-4 mb-8"></div>
        {description && <p className="text-lg text-text-secondary mb-8">{description}</p>}
        <div className="space-y-8">{children}</div>
    </div>
);

const SectionCard: React.FC<{children: React.ReactNode}> = ({children}) => (
    <div className="p-8 bg-bg-secondary/50 rounded-2xl border border-border-color shadow-lg">{children}</div>
);

const AudioSettingsContent: React.FC = () => {
    const { addToast } = useToast();
    const [ttsVoice, setTtsVoice] = useLocalStorage('bubble_tts_voice', 'Puck');
    const [ttsSpeed, setTtsSpeed] = useLocalStorage('bubble_tts_speed', 1);
    
    const VOICES = [
        { id: 'Puck', name: 'Puck (Energetic)', desc: 'Great for lively conversation.' },
        { id: 'Charon', name: 'Charon (Deep)', desc: 'Authoritative and calm.' },
        { id: 'Kore', name: 'Kore (Balanced)', desc: 'Natural and friendly.' },
        { id: 'Fenrir', name: 'Fenrir (Strong)', desc: 'Clear and distinct.' },
        { id: 'Aoede', name: 'Aoede (Soft)', desc: 'Gentle and soothing.' },
    ];

    const handleSave = () => {
        addToast("Audio settings saved!", "success");
    }

    return (
        <Section title="Voice & Audio" description="Customize how Bubble sounds when using Text-to-Speech or Live Mode.">
            <SectionCard>
                <h3 className="text-xl font-bold text-white mb-6">Text-to-Speech Voice</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {VOICES.map(voice => (
                        <button
                            key={voice.id}
                            onClick={() => { setTtsVoice(voice.id); handleSave(); }}
                            className={`p-4 rounded-xl border text-left transition-all ${ttsVoice === voice.id ? 'bg-primary-start/10 border-primary-start ring-1 ring-primary-start' : 'bg-black/20 border-white/10 hover:border-white/30'}`}
                        >
                            <div className="flex items-center justify-between mb-1">
                                <span className="font-semibold text-white">{voice.name}</span>
                                {ttsVoice === voice.id && <CheckCircleIcon className="w-5 h-5 text-primary-start" />}
                            </div>
                            <p className="text-sm text-gray-400">{voice.desc}</p>
                        </button>
                    ))}
                </div>
            </SectionCard>
            
            <SectionCard>
                <h3 className="text-xl font-bold text-white mb-6">Speaking Rate</h3>
                <div className="space-y-4">
                    <div className="flex justify-between text-sm text-gray-400">
                        <span>Slow</span>
                        <span>Normal</span>
                        <span>Fast</span>
                    </div>
                    <input 
                        type="range" 
                        min="0.5" 
                        max="2" 
                        step="0.1" 
                        value={ttsSpeed} 
                        onChange={(e) => { setTtsSpeed(parseFloat(e.target.value)); }}
                        onMouseUp={handleSave}
                        onTouchEnd={handleSave}
                        className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-primary-start"
                    />
                    <p className="text-center text-white font-mono">{ttsSpeed}x</p>
                </div>
            </SectionCard>
        </Section>
    );
};

const ProfileContent: React.FC = () => {
    const { profile, updateUserProfile, isGuest } = useAuth();
    const [displayName, setDisplayName] = useState('');
    
    useEffect(() => { if (profile) setDisplayName(profile.roblox_username || ''); }, [profile]);

    const handleSave = async () => {
        if (!displayName.trim() || isGuest) return;
        await updateUserProfile({ roblox_username: displayName.trim() });
    };
    
    return (
        <Section title="Public Profile">
             <SectionCard>
                <div className="space-y-6">
                    <div>
                        <label className="block text-lg font-medium text-text-secondary mb-2">Display Name</label>
                        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={isGuest} className="w-full px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-lg text-white focus:ring-2 focus:ring-primary-start" />
                    </div>
                    <div className="flex justify-end">
                        <button onClick={handleSave} disabled={isGuest} className="px-6 py-3 bg-primary-start text-white rounded-xl font-bold hover:bg-primary-start/80 transition-colors disabled:opacity-50">Save Changes</button>
                    </div>
                </div>
            </SectionCard>
        </Section>
    )
}

export const SettingsPage: React.FC<{onBack: () => void}> = ({ onBack }) => {
    const { profile, isGuest } = useAuth();
    const [activeTab, setActiveTab] = useState<SettingsTab>('profile');

    // UNHIDE API KEYS AND APPEARANCE FOR GUESTS
    const navItems = [
        { id: 'profile', label: 'Public Profile', icon: UserCircleIcon },
        { id: 'account', label: 'Account', icon: CreditCardIcon, hidden: isGuest },
        { id: 'billing', label: 'Billing', icon: CurrencyDollarIcon, hidden: isGuest },
        { id: 'models', label: 'AI Models', icon: WrenchScrewdriverIcon },
        { id: 'audio', label: 'Voice & Audio', icon: SpeakerWaveIcon },
        { id: 'apiKeys', label: 'API Keys', icon: KeyIcon }, // Now available for guests
        { id: 'memory', label: 'Memory', icon: CpuChipIcon },
        { id: 'appearance', label: 'Appearance', icon: PaintBrushIcon }, // Now available
    ].filter(item => !item.hidden) as any;

    const renderContent = () => {
        switch(activeTab) {
            case 'profile': return <ProfileContent />;
            case 'account': return <div>Account Settings (Unavailable for Guest)</div>;
            case 'billing': return <BillingSettings />;
            case 'models': return <ModelPreferences />;
            case 'audio': return <AudioSettingsContent />;
            case 'apiKeys': 
                return (
                    <Section title="API Keys" description="Configure your API keys to use advanced models. Keys are stored safely in your browser session.">
                        <SectionCard>
                            {/* Reusing ApiKeySetupPage logic but embedded */}
                            <ApiKeySetupPage /> 
                        </SectionCard>
                    </Section>
                );
            case 'memory': return <MemoryDashboard />;
            case 'appearance': return (
                <Section title="Appearance">
                    <SectionCard>
                        <p className="text-gray-400">Dark mode is currently enforced for the best experience.</p>
                    </SectionCard>
                </Section>
            );
            default: return null;
        }
    }

    return (
        <div className="flex h-[calc(100vh-4rem)] bg-bg-primary">
            <aside className="w-80 flex-shrink-0 p-6 border-r border-border-color overflow-y-auto bg-bg-secondary">
                <div className="flex items-center gap-4 mb-10 px-2">
                    <img src={profile?.avatar_url || FALLBACK_AVATAR_SVG} alt="Avatar" className="w-16 h-16 rounded-full bg-bg-tertiary" />
                    <div>
                        <p className="font-bold text-xl text-text-primary truncate">{profile?.roblox_username}</p>
                        <p className="text-sm text-text-secondary">{isGuest ? 'Guest Account' : 'Personal Account'}</p>
                    </div>
                </div>
                <nav className="space-y-2">
                    {navItems.map((item: any) => (
                        <button
                            key={item.id}
                            onClick={() => setActiveTab(item.id)}
                            className={`w-full flex items-center gap-4 px-4 py-4 text-base font-medium rounded-xl transition-all text-left ${
                                activeTab === item.id ? 'bg-primary-start text-white shadow-lg' : 'text-text-secondary hover:bg-white/5 hover:text-text-primary'
                            }`}
                        >
                            <item.icon className={`w-6 h-6 ${activeTab === item.id ? 'text-white' : 'text-gray-500'}`} />
                            <span>{item.label}</span>
                        </button>
                    ))}
                </nav>
            </aside>
            <main className="flex-1 p-12 overflow-y-auto bg-bg-primary">
                 <AnimatePresence mode="wait">
                    <motion.div
                        key={activeTab}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.3 }}
                        className="h-full"
                    >
                       {renderContent()}
                    </motion.div>
                </AnimatePresence>
            </main>
        </div>
    );
};
