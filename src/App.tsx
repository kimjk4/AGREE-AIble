import React from 'react';

// --- TYPE DEFINITIONS ---
type DomainId = 1 | 2 | 3 | 4 | 5 | 6;
type Vendor = "openai" | "anthropic" | "gemini";

interface MiniSearch<T = any> {
    new (options: any): MiniSearch<T>;
    addAll(documents: T[]): void;
    addAllAsync(documents: T[]): Promise<void>;
    search(query: string, options?: any): (T & { score: number; id: any })[];
}

interface EvidenceCitation {
    page?: number;
    section?: string;
}

interface DomainItem {
    item: number;
    score_1to7: number;
    confidence_0to100: number;
    evidence_citations: EvidenceCitation[];
    justification: string;
}

interface DomainResult {
    name: string;
    items: DomainItem[];
    calculated_score?: number;
}

interface ResultsState {
    digest?: Record<string, unknown>;
    domains?: Partial<Record<DomainId, DomainResult>>;
    overall?: {
        overall_quality_1to7: number;
        recommend_use: string;
        justification: string;
    };
}

interface JsonGenOptions<T> {
    system?: string;
    user: string;
    validator?: (data: any) => T;
    signal: AbortSignal;
}

interface ModelClient {
    generateJSON<T>(opts: JsonGenOptions<T>): Promise<T>;
    generateText(opts: Omit<JsonGenOptions<any>, 'validator'>): Promise<string>;
}


// --- MANUAL VALIDATORS ---
const validators = {
    domainResult: (data: any): DomainItem[] => {
        let itemsToProcess: any[] = [];

        if (typeof data === 'object' && !Array.isArray(data) && data !== null) {
            if ('item' in data && 'score_1to7' in data) {
                itemsToProcess = [data];
            } else {
                const potentialArray = Object.values(data).find(value => Array.isArray(value));
                if (potentialArray) {
                    itemsToProcess = potentialArray as any[];
                }
            }
        } else if (Array.isArray(data)) {
            itemsToProcess = data;
        }

        if (itemsToProcess.length === 0) {
            throw new Error("Domain result is not a valid array of items or a recognized object structure.");
        }

        return itemsToProcess.map((item, idx) => {
            if (typeof item.item !== 'number' || item.item < 1 || item.item > 23) {
                throw new Error(`Item ${idx}: 'item' must be a number between 1 and 23`);
            }
            if (typeof item.score_1to7 !== 'number' || item.score_1to7 < 1 || item.score_1to7 > 7) {
                throw new Error(`Item ${idx}: 'score_1to7' must be between 1 and 7`);
            }
            if (typeof item.confidence_0to100 !== 'number' || item.confidence_0to100 < 0 || item.confidence_0to100 > 100) {
                throw new Error(`Item ${idx}: 'confidence_0to100' must be between 0 and 100`);
            }
            
            if (typeof item.justification !== 'string') {
                item.justification = "";
            }
            if (item.justification.length > 300) {
                item.justification = item.justification.substring(0, 297) + "...";
            }

            if (!Array.isArray(item.evidence_citations)) {
                throw new Error(`Item ${idx}: 'evidence_citations' must be an array`);
            }
            item.evidence_citations.forEach((citation: any, cIdx: number) => {
                if (citation.section === null) {
                    citation.section = "";
                }
                if (citation.page !== undefined && typeof citation.page !== 'number') {
                    throw new Error(`Item ${idx}, Citation ${cIdx}: 'page' must be a number`);
                }
                if (citation.section !== undefined && typeof citation.section !== 'string') {
                    throw new Error(`Item ${idx}, Citation ${cIdx}: 'section' must be a string`);
                }
            });
            return item as DomainItem;
        });
    },
    digest: (data: any): Record<string, unknown> => {
        if (typeof data !== 'object' || data === null) {
            throw new Error("Digest must be an object");
        }
        return data;
    },
    overallAssessment: (data: any) => {
        if (typeof data.overall_quality_1to7 !== 'number' || data.overall_quality_1to7 < 1 || data.overall_quality_1to7 > 7) {
            throw new Error("'overall_quality_1to7' must be between 1 and 7");
        }
        if (!['yes', 'yes_with_modifications', 'no'].includes(data.recommend_use)) {
            throw new Error("'recommend_use' must be 'yes', 'yes_with_modifications', or 'no'");
        }
        if (typeof data.justification !== 'string') {
            data.justification = "";
        }
        return data;
    }
};

// --- PROMPT PACK DATA (abbreviated for brevity) ---
const AGREE_II_PROMPT_PACK = {
    "metadata": {
        "name": "AGREE II LLM Prompt Pack",
        "version": "v1.0",
        "created": "2025-08-12",
        "notes": "Prompts and schemas to appraise guidelines with AGREE II using LLMs.",
        "source_manual": "AGREE II User's Manual & Instrument (2009; update 2017)",
        "license_and_use": "Per manual: reproduce for education, QA, and critical appraisal; not for commercial purposes."
    },
    "recommended_model_settings": { "temperature": 0.1, "top_p": 1.0, "frequency_penalty": 0.0, "presence_penalty": 0.0 },
    "prompts": {
        "system_prompt": "You are an AGREE II appraiser. Judge only what is reported in the supplied text.\n\nRules:\n• Use the 23-item AGREE II (1–7). If information is missing or vague, score 1 and say why briefly.\n• Cite evidence with page/section anchors from the provided snippets only.\n• Output compact JSON exactly as requested (no chain of thought).\n• Do NOT compute a composite total; only item scores now. Domain scoring is handled downstream.\n• If authors claim something is \"not applicable,\" treat it as absent for that item and explain briefly.",
        "digest_prompt": "Task: Read the provided guideline text and produce a structured DIGEST for AGREE II scoring...",
        "domain_prompts": [
            { "domain": 1, "name": "Scope & Purpose", "items": [1, 2, 3], "keywords": "objective, scope, purpose, aim, question, population, patient", "prompt": "Domain 1 — Scope & Purpose\nGrade items [1, 2, 3]..." },
            { "domain": 2, "name": "Stakeholder Involvement", "items": [4, 5, 6], "keywords": "stakeholder, development group, patient, public, user, clinician", "prompt": "Domain 2 — Stakeholder Involvement\nGrade items [4, 5, 6]..." },
            { "domain": 3, "name": "Rigour of Development", "items": [7, 8, 9, 10, 11, 12, 13, 14], "keywords": "search, database, evidence, criteria, quality, formulate, recommendation, review, update", "prompt": "Domain 3 — Rigour of Development\nGrade items [7, 8, 9, 10, 11, 12, 13, 14]..." },
            { "domain": 4, "name": "Clarity of Presentation", "items": [15, 16, 17], "keywords": "recommendation, specific, unambiguous, options, management, key", "prompt": "Domain 4 — Clarity of Presentation\nGrade items [15, 16, 17]..." },
            { "domain": 5, "name": "Applicability", "items": [18, 19, 20, 21], "keywords": "applicability, barrier, facilitator, implementation, resource, cost, audit, monitoring", "prompt": "Domain 5 — Applicability\nGrade items [18, 19, 20, 21]..." },
            { "domain": 6, "name": "Editorial Independence", "items": [22, 23], "keywords": "funding, funder, conflict of interest, competing interest, disclosure, independence", "prompt": "Domain 6 — Editorial Independence\nGrade items [22, 23]..." }
        ],
        "overall_assessment_prompt": "AGREE II — Overall Guideline Assessment\n\nUsing ONLY the information supplied..."
    }
};

// --- UTILITY FUNCTIONS ---
function calculateDomainScore(items: DomainItem[], domainConfig: { items: number[] }): number {
    const obtainedScore = items.reduce((sum, item) => sum + item.score_1to7, 0);
    const numItems = domainConfig.items.length;
    const maxPossibleScore = 7 * numItems;
    const minPossibleScore = 1 * numItems;
    if (maxPossibleScore === minPossibleScore) return 0;
    const scaledScore = ((obtainedScore - minPossibleScore) / (maxPossibleScore - minPossibleScore)) * 100;
    return Math.round(scaledScore);
}

async function withRetries<T>(fn: () => Promise<T>, tries = 3, baseMs = 500): Promise<T> { /* ... Function content is correct ... */ }
async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> { /* ... Function content is correct ... */ }

// --- MODEL CLIENT FACTORY ---
function getClient(vendor: Vendor, apiKey: string): ModelClient { /* ... Function content is correct ... */ }


// --- ICONS ---
const Icon = ({ path, className = "w-6 h-6" }: { path: string, className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
        <path d={path} />
    </svg>
);
const ICONS = {
    upload: <Icon path="M9.99999 15.172L19.192 5.979L20.607 7.393L9.99999 18L3.63599 11.636L5.04999 10.222L9.99999 15.172Z" />,
    fileText: <Icon path="M15 4H5V20H19V8H15V4ZM3 2.9918C3 2.44405 3.44749 2 3.9982 2H16L21 7V20.9925C21 21.5489 20.5519 22 20.0058 22H3.9942C3.44512 22 3 21.555 3 21.0082V2.9918ZM7 10H17V12H7V10ZM7 14H17V16H7V14Z" />,
    play: <Icon path="M8 5V19L19 12L8 5Z" />,
    checkCircle: <Icon path="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM10 17L5 12L6.41 10.59L10 14.17L17.59 6.58L19 8L10 17Z" />,
    download: <Icon path="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 21.1 21.1 22 20 22H4C2.9 22 2 21.1 2 20V12H4V19Z" />,
    alertCircle: <Icon path="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM11 15H13V17H11V15ZM11 7H13V13H11V7Z" />,
    clock: <Icon path="M12 2C6.486 2 2 6.486 2 12C2 17.514 6.486 22 12 22C17.514 22 22 17.514 22 12C22 6.486 17.514 2 12 2ZM12 20C7.589 20 4 16.411 4 12C4 7.589 7.589 4 12 4C16.411 4 20 7.589 20 12C20 16.411 16.411 20 12 20ZM13 7H11V12H16V14H11V7Z" className="animate-spin" />,
    brain: <Icon path="M12 2C9.25 2 7 4.25 7 7C7 8.85 8.1 10.45 9.65 11.25C8.85 11.45 8.1 11.8 7.45 12.25C6.45 12.9 6 13.9 6 15V16H18V15C18 13.9 17.55 12.9 16.55 12.25C15.9 11.8 15.15 11.45 14.35 11.25C15.9 10.45 17 8.85 17 7C17 4.25 14.75 2 12 2ZM12 4C13.65 4 15 5.35 15 7C15 8.65 13.65 10 12 10C10.35 10 9 8.65 9 7C9 5.35 10.35 4 12 4Z" />
};

// --- MAIN COMPONENT ---
const AgreeIIWorkflow: React.FC = () => {
    const [file, setFile] = React.useState<File | null>(null);
    const [guidelinePages, setGuidelinePages] = React.useState<{ id: number; page: number; text: string }[]>([]);
    const [searchIndex, setSearchIndex] = React.useState<MiniSearch | null>(null);
    const [currentStep, setCurrentStep] = React.useState<number>(0);
    const [results, setResults] = React.useState<ResultsState>({});
    const [isProcessing, setIsProcessing] = React.useState<boolean>(false);
    const [processingStatus, setProcessingStatus] = React.useState<string>('');
    const [error, setError] = React.useState<string>('');
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const [isPdfJsReady, setIsPdfJsReady] = React.useState<boolean>(false);
    const [isMiniSearchReady, setIsMiniSearchReady] = React.useState<boolean>(false);
    const [abortController, setAbortController] = React.useState<AbortController | null>(null);
    const [selectedLlm, setSelectedLlm] = React.useState<Vendor>('gemini');
    const [apiKeys, setApiKeys] = React.useState<Record<Vendor, string>>({
        gemini: '', openai: '', anthropic: ''
    });

    const steps = [
        { name: 'Upload Guideline', icon: ICONS.upload },
        { name: 'Generate Digest', icon: ICONS.fileText },
        { name: 'Evaluate Domains', icon: ICONS.play },
        { name: 'Overall Assessment', icon: ICONS.checkCircle },
        { name: 'Download Results', icon: ICONS.download }
    ];

    React.useEffect(() => { /* ... Function content is correct ... */ }, []);
    async function extractPdfPages(file: File): Promise<{ id: number; page: number; text: string }[]> { /* ... Function content is correct ... */ }
    const handleCancel = () => { /* ... Function content is correct ... */ };
    const runCancellableProcess = async (processFunction: (signal: AbortSignal) => Promise<void>) => { /* ... Function content is correct ... */ };
    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => { /* ... Function content is correct ... */ };
    const generateDigest = () => runCancellableProcess(async (signal) => { /* ... Function content is correct ... */ });
    
    const evaluateDomains = () => runCancellableProcess(async (signal) => {
        if (!searchIndex) throw new Error("Search index is not available.");
        setResults(prev => ({ ...prev, domains: {} }));
        const domainPrompts = AGREE_II_PROMPT_PACK.prompts.domain_prompts;
        const client = getClient(selectedLlm, apiKeys[selectedLlm]);

        const scoreDomain = async (domainConfig: typeof domainPrompts[0]) => {
            if (signal.aborted) throw new Error('Aborted');
            setProcessingStatus(`Evaluating Domain ${domainConfig.domain}: ${domainConfig.name}...`);
            const searchResults = searchIndex.search(domainConfig.keywords, { prefix: true, fuzzy: 0.2 });
            const evidenceSnippets = searchResults.slice(0, 5).map(result => ({ snippet: result.text.slice(0, 1000), pages: [result.page] }));
            const digestSlice = { scope_purpose: results.digest?.scope_purpose, stakeholders: results.digest?.stakeholders, rigour: results.digest?.rigour, clarity: results.digest?.clarity, applicability: results.digest?.applicability, editorial_independence: results.digest?.editorial_independence, };
            const domainPrompt = domainConfig.prompt.replace('<DIGEST>{...domain-relevant fields only...}</DIGEST>', `<DIGEST>${JSON.stringify(digestSlice, null, 2)}</DIGEST>`).replace('<EVIDENCE>[{\"snippet\":\"...\", \"pages\":[...]}]</EVIDENCE>', `<EVIDENCE>${JSON.stringify(evidenceSnippets, null, 2)}</EVIDENCE>`);

            const domainItems = await client.generateJSON({ user: domainPrompt, system: AGREE_II_PROMPT_PACK.prompts.system_prompt, validator: validators.domainResult, signal, });
            const score = calculateDomainScore(domainItems, domainConfig);
            if (signal.aborted) throw new Error('Aborted');

            setResults(prev => {
                const newDomainData = { name: domainConfig.name, items: domainItems, calculated_score: score };
                return { ...prev, domains: { ...prev.domains, [domainConfig.domain as DomainId]: newDomainData } };
            });
        };

        await mapLimit(domainPrompts, 2, scoreDomain);
        if (signal.aborted) return;
        setProcessingStatus('All domains evaluated.');
        setCurrentStep(3);
    });
    
    const generateOverallAssessment = () => runCancellableProcess(async (signal) => { /* ... Function content is correct ... */ });
    const downloadResults = () => { /* ... Function content is correct ... */ };
    const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => { /* ... Function content is correct ... */ };

    // --- UI Components ---
    const StepIndicator = ({ step, index, isActive, isCompleted }: { step: { name: string, icon: JSX.Element }, index: number, isActive: boolean, isCompleted: boolean }) => ( /* ... JSX content is correct ... */ );
    const ApiKeyManager = () => ( /* ... JSX content is correct ... */ );

    // CORRECTED: Restored full content for all steps to fix the syntax error.
    const renderStepContent = () => {
        const totalChars = guidelinePages.reduce((acc, p) => acc + p.text.length, 0);
        const areLibrariesReady = isPdfJsReady && isMiniSearchReady;
        switch (currentStep) {
            case 0:
                return (
                    <div className="text-center">
                        <h2 className="text-xl font-semibold mb-2">Upload Clinical Guideline</h2>
                        <p className="text-gray-600 mb-6">Upload a PDF or text file to begin.</p>
                        <div className={`border-2 border-dashed border-gray-300 rounded-lg p-10 transition-colors ${!areLibrariesReady ? 'cursor-not-allowed bg-gray-100' : 'cursor-pointer hover:border-blue-400 hover:bg-blue-50'}`} onClick={() => areLibrariesReady && fileInputRef.current?.click()}>
                            <div className="mx-auto text-gray-400 w-12 h-12">{!areLibrariesReady ? ICONS.clock : ICONS.upload}</div>
                            <p className="text-gray-600 mt-2">{!areLibrariesReady ? 'Loading libraries...' : 'Click to upload or drag and drop'}</p>
                            <p className="text-sm text-gray-400 mt-1">PDF or TXT files supported</p>
                        </div>
                        <input ref={fileInputRef} type="file" accept=".pdf,.txt" onChange={handleFileUpload} className="hidden" disabled={!areLibrariesReady} />
                        {file && <div className="mt-4 p-3 bg-blue-100 text-blue-800 rounded-md">File ready: {file.name}</div>}
                    </div>
                );
            case 1:
                return (
                    <div>
                        <h2 className="text-xl font-semibold mb-2">Generate Structured Digest</h2>
                        <p className="text-gray-600 mb-6">The LLM will now read the document and create a structured summary for the assessment.</p>
                        <div className="mb-4 p-4 bg-gray-100 rounded-md">
                            <p className="text-sm text-gray-800">Document loaded with {guidelinePages.length} pages and {totalChars.toLocaleString()} characters.</p>
                        </div>
                        <button onClick={generateDigest} disabled={isProcessing || !apiKeys[selectedLlm]} className="bg-blue-500 text-white px-6 py-2 rounded-md hover:bg-blue-600 disabled:opacity-50 flex items-center">
                            {isProcessing ? ICONS.clock : ICONS.fileText} <span className="ml-2">{isProcessing ? 'Generating...' : 'Generate Digest'}</span>
                        </button>
                        {!apiKeys[selectedLlm] && <p className="text-sm text-red-600 mt-2">Please provide an API key for {selectedLlm}</p>}
                    </div>
                );
            case 2:
                return (
                    <div>
                        <h2 className="text-xl font-semibold mb-2">Evaluate AGREE II Domains</h2>
                        <p className="text-gray-600 mb-6">The LLM will now assess each domain individually based on the digest and evidence snippets.</p>
                        <div className="mb-4 p-4 bg-green-100 rounded-md">
                            <h3 className="font-medium text-green-800">Digest Generated Successfully!</h3>
                            <details className="mt-2">
                                <summary className="cursor-pointer text-sm text-green-700">View digest preview</summary>
                                <pre className="mt-2 text-xs bg-white p-2 rounded border overflow-auto max-h-40">{JSON.stringify(results.digest, null, 2)}</pre>
                            </details>
                        </div>
                        <button onClick={evaluateDomains} disabled={isProcessing} className="bg-blue-500 text-white px-6 py-2 rounded-md hover:bg-blue-600 disabled:opacity-50 flex items-center">
                             {isProcessing ? ICONS.clock : ICONS.play} <span className="ml-2">{isProcessing ? 'Evaluating...' : 'Evaluate All Domains'}</span>
                        </button>
                        <div className="space-y-2 mt-4">
                            {AGREE_II_PROMPT_PACK.prompts.domain_prompts.map(d => (
                                <div key={d.domain} className={`p-2 rounded-md text-sm ${results.domains?.[d.domain as DomainId] ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                                    Domain {d.domain}: {d.name} - {results.domains?.[d.domain as DomainId] ? 'Completed' : 'Pending'}
                                </div>
                            ))}
                        </div>
                    </div>
                );
            case 3:
                return (
                    <div>
                        <h2 className="text-xl font-semibold mb-2">Generate Overall Assessment</h2>
                        <p className="text-gray-600 mb-6">All domains have been evaluated. The LLM will now provide a final quality rating and recommendation.</p>
                        <div className="mb-4 p-4 bg-green-100 rounded-md">
                            <h3 className="font-medium text-green-800">Domain Evaluation Complete!</h3>
                        </div>
                        <button onClick={generateOverallAssessment} disabled={isProcessing} className="bg-blue-500 text-white px-6 py-2 rounded-md hover:bg-blue-600 disabled:opacity-50 flex items-center">
                            {isProcessing ? ICONS.clock : ICONS.checkCircle} <span className="ml-2">{isProcessing ? 'Generating...' : 'Generate Overall Assessment'}</span>
                        </button>
                    </div>
                );
            case 4:
                return (
                    <div className="w-full">
                        <div className="text-center">
                            <h2 className="text-2xl font-semibold mb-2">Assessment Complete</h2>
                            <p className="text-gray-600 mb-6">Review the full AGREE II assessment results below or download the complete JSON file.</p>
                        </div>
                        <div className="mb-8 p-6 bg-blue-50 border border-blue-200 rounded-lg text-left max-w-3xl mx-auto shadow-md">
                            <h3 className="font-bold text-xl text-blue-900 mb-3">Final Assessment Summary</h3>
                            {results.overall && (
                                <div className="space-y-2 text-gray-800">
                                    <p><strong>Overall Quality:</strong> <span className="font-semibold text-blue-700 text-lg">{results.overall.overall_quality_1to7}/7</span></p>
                                    <p><strong>Recommendation:</strong> <span className="font-semibold text-blue-700 capitalize">{results.overall.recommend_use.replace(/_/g, ' ')}</span></p>
                                    <p><strong>Justification:</strong> <span className="italic">"{results.overall.justification}"</span></p>
                                </div>
                            )}
                        </div>
                        <div className="mt-8 text-left max-w-4xl mx-auto">
                            <h3 className="font-bold text-xl text-gray-800 mb-4 text-center">Detailed Domain Scores</h3>
                            <div className="space-y-4">
                                {AGREE_II_PROMPT_PACK.prompts.domain_prompts.map(domainInfo => {
                                    const domainResult = results.domains?.[domainInfo.domain as DomainId];
                                    if (!domainResult) return null;
                                    return (
                                        <details key={domainInfo.domain} className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm" open>
                                            <summary className="flex justify-between items-center font-semibold text-lg cursor-pointer text-gray-800 hover:text-blue-600 transition-colors">
                                                <span>Domain {domainInfo.domain}: {domainInfo.name}</span>
                                                <span className="font-bold text-xl text-indigo-600 bg-indigo-100 px-3 py-1 rounded-full">
                                                    {domainResult.calculated_score}%
                                                </span>
                                            </summary>
                                            <div className="mt-4 pt-4 space-y-4 border-t">
                                                {domainResult.items.map(item => (
                                                    <div key={item.item} className="pl-4 border-l-2 border-gray-200">
                                                        <p className="font-semibold text-gray-900">
                                                            Item {item.item}: <span className="font-bold text-blue-600">{item.score_1to7}/7</span>
                                                        </p>
                                                        <blockquote className="text-sm text-gray-600 italic mt-1 border-l-4 border-gray-300 pl-3">
                                                            {item.justification}
                                                        </blockquote>
                                                    </div>
                                                ))}
                                            </div>
                                        </details>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="mt-10 text-center">
                            <button onClick={downloadResults} className="bg-green-500 text-white px-8 py-3 rounded-md hover:bg-green-600 flex items-center mx-auto text-lg font-semibold shadow-lg hover:shadow-xl transition-shadow">
                                {ICONS.download} <span className="ml-2">Download Full Results (JSON)</span>
                            </button>
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div className="max-w-6xl mx-auto p-4 sm:p-6 bg-gray-50 min-h-screen font-sans">
            <div className="bg-white rounded-lg shadow-md p-6">
                <div className="mb-8 text-center">
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">AGREE-AIble: AGREE II Guideline Assessment</h1>
                    <p className="text-gray-600">An interactive tool for automated clinical guideline appraisal using Large Language Models (LLMs).</p>
                </div>
                <ApiKeyManager />
                <div className="mb-8">
                    <div className="flex items-center justify-between">
                        {steps.map((step, index) => (
                            <StepIndicator key={index} step={step} index={index} isActive={currentStep === index} isCompleted={currentStep > index} />
                        ))}
                    </div>
                </div>
                {error && (
                    <div className="mb-6 p-4 bg-red-100 border border-red-300 rounded-md flex items-center">
                        <div className="text-red-500 mr-3 w-6 h-6">{ICONS.alertCircle}</div>
                        <span className="text-red-800">{error}</span>
                    </div>
                )}
                {isProcessing && (
                     <div className="mb-6 p-4 bg-blue-100 border border-blue-300 rounded-md flex items-center justify-between">
                         <div className="flex items-center">
                             <div className="text-blue-500 mr-3 w-6 h-6">{ICONS.clock}</div>
                             <span className="text-blue-800 font-medium">{processingStatus}</span>
                         </div>
                         <button onClick={handleCancel} className="bg-red-500 text-white px-3 py-1 rounded-md text-sm hover:bg-red-600">Cancel</button>
                     </div>
                )}
                <div className="bg-white rounded-lg p-6 border border-gray-200 min-h-[300px] flex items-center justify-center">
                    {renderStepContent()}
                </div>
            </div>
        </div>
    );
};

export default AgreeIIWorkflow;
