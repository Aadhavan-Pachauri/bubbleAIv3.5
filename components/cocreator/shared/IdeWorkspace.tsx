
import React, { useState, useEffect, useRef } from 'react';
import Split from 'react-split-grid';
import Editor from '@monaco-editor/react';
import { FileExplorer } from './FileExplorer';
import { Message, Project, Chat, WorkspaceMode, ChatWithProjectData } from '../../../types';

export interface IdeWorkspaceProps {
  project: Project;
  chat: ChatWithProjectData | null;
  geminiApiKey: string;
  messages: Message[];
  isLoadingHistory: boolean;
  isCreatingChat: boolean;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  onSendMessage: (text: string, files?: File[] | null, chat?: ChatWithProjectData | null, modelOverride?: string) => void;
  onChatUpdate: ((updates: Partial<Chat>) => void) | null;
  onActiveProjectUpdate: ((updates: Partial<Project>) => Promise<void>) | null;
  searchQuery: string;
  onSearchResultsChange: (indices: number[]) => void;
  currentSearchResultMessageIndex: number;
  isAdmin: boolean;
  workspaceMode: WorkspaceMode;
  projectType: 'website' | 'roblox_game';
  loadingMessage: string;
  onStop?: () => void;
}

export const IdeWorkspace: React.FC<IdeWorkspaceProps> = (props) => {
    const { projectType, project, onActiveProjectUpdate } = props;
    
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [editorContent, setEditorContent] = useState('');
    
    // Track the file names to detect additions
    const prevFilesRef = useRef(Object.keys(project.files || {}));

    useEffect(() => {
        const currentFiles = Object.keys(project.files || {});
        const prevFiles = prevFilesRef.current;
        
        // Check if a new file was added or if a specific file content changed significantly 
        // (simple length check or presence check for streaming effect)
        // Specifically, if we are streaming, we want to jump to the file being edited.
        // We can infer this by checking which file changed since last render if the length changed.
        
        // Heuristic: If only one file changed content, switch to it (unless user is actively typing?)
        // For now, let's just switch if a *new* file appears.
        const newFile = currentFiles.find(f => !prevFiles.includes(f));
        if (newFile) {
            setSelectedFile(newFile);
        } else {
            // If no new file, but we have a selected file, check if it still exists
            if (selectedFile && !currentFiles.includes(selectedFile)) {
                setSelectedFile(null);
            }
            // If no file selected and we have files, select the last one (often the newest)
            else if (!selectedFile && currentFiles.length > 0) {
                setSelectedFile(currentFiles[currentFiles.length - 1]);
            }
        }
        
        prevFilesRef.current = currentFiles;
    }, [project.files, selectedFile]);

    useEffect(() => {
        const content = selectedFile
            ? project.files?.[selectedFile]?.content ?? `// Error: Could not find content for ${selectedFile}`
            : `// Select a file to view its code`;
        setEditorContent(content);
    }, [selectedFile, project.files]);

    const handleFileSelect = (filePath: string) => {
        setSelectedFile(filePath);
    };

    const handleEditorChange = (value: string | undefined) => {
        if (selectedFile && value !== undefined && onActiveProjectUpdate) {
            const updatedFiles = {
                ...(project.files || {}),
                [selectedFile]: { content: value }
            };
            onActiveProjectUpdate({ files: updatedFiles });
        }
    };

    return (
        <div className="h-full w-full bg-bg-primary text-white">
            <Split
                gridTemplateColumns="250px 8px 1fr"
                minSize={200}
                cursor="col-resize"
            >
                {(split: any) => (
                    <div className="grid h-full" {...split.getGridProps()}>
                        <div className="h-full bg-bg-secondary overflow-hidden">
                           <FileExplorer onFileSelect={handleFileSelect} project={project} />
                        </div>

                        <div className="h-full bg-bg-tertiary cursor-col-resize" {...split.getGutterProps('column', 1)} />
                        
                        <div className="h-full w-full overflow-hidden bg-[#1e1e1e]">
                            <Editor
                                height="100%"
                                path={selectedFile || 'default'} 
                                language={projectType === 'website' ? 'html' : 'lua'}
                                theme="vs-dark"
                                value={editorContent}
                                onChange={handleEditorChange}
                                options={{ 
                                    minimap: { enabled: false }, 
                                    fontSize: 14, 
                                    wordWrap: 'on',
                                    automaticLayout: true,
                                }}
                            />
                        </div>
                    </div>
                )}
            </Split>
        </div>
    );
};
