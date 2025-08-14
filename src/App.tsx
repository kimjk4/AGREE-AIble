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

// MODIFIED: Added calculated_score
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


// --- MANUAL VALIDATORS (replacing Zod) ---
const validators = {
    domainResult: (data: any): DomainItem[] => {
        let itemsToProcess: any[] = [];

        // Handle cases where the LLM returns a single object instead of an array.
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

// --- PROMPT PACK DATA ---
const AGREE_II_PROMPT_PACK = {
    "metadata": { /* ... content unchanged ... */ },
    "recommended_model_settings": { /* ... content unchanged ... */ },
    "prompts": { /* ... content unchanged ... */ }
};

// --- UTILITY FUNCTIONS ---

// NEW: Function to calculate domain score based on the AGREE II manual
function calculateDomainScore(
    items: DomainItem[],
    domainConfig: { items: number[] }
): number {
    const obtainedScore = items.reduce((sum, item) => sum + item.score_1to7, 0);
    const numItems = domainConfig.items.length;

    // Since the appraiser is the LLM, the number of appraisers is 1.
    const maxPossibleScore = 7 * numItems;
    const minPossibleScore = 1 * numItems;

    if (maxPossibleScore === minPossibleScore) return 0; // Avoid division by zero

    const scaledScore = ((obtainedScore - minPossibleScore) / (maxPossibleScore - minPossibleScore)) * 100;

    return Math.round(scaledScore);
}

async function withRetries<T>(fn: () => Promise<T>, tries = 3, baseMs = 500): Promise<T> {
    let lastErr: any;
    for (let i = 0; i < tries; i++) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e;
            if ((e as Error).name === 'AbortError') throw e;
            await new Promise(r => setTimeout(r, baseMs * 2 ** i));
        }
    }
    throw lastErr;
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    const activePromises: Set<Promise<void>> = new Set();
    let index = 0;

    const run = async () => {
        while (index < items.length) {
            const currentIndex = index++;
            const item = items[currentIndex];
            const promise = (async () => {
                results[currentIndex] = await worker(item);
            })().then(p => { activePromises.delete(p as any); return p; });
            activePromises.add(promise);
            if (activePromises.size >= limit) {
                await Promise.race(activePromises);
            }
        }
    };

    const runners = Array.from({ length: Math.min(limit, items.length) }, run);
    await Promise.all(runners);
    await Promise.all(Array.from(activePromises));
    return results;
}

// --- MODEL CLIENT FACTORY ---
function getClient(vendor: Vendor, apiKey: string): ModelClient {
    // ... function content unchanged ...
    const { temperature, top_p } = AGREE_II_PROMPT_PACK.recommended_model_settings;

    const isOpenAIReasoningModel = (model: string) => /^gpt-5\b|^o[0-9]/i.test(model);

    const safeParseJson = <T,>(text: string, validator?: (data: any) => T): T => {
        try {
            const match = text.match(/```json([\s\S]*?)```/i);
            const jsonString = match ? match[1].trim() : text.trim();
            const parsedData = JSON.parse(jsonString);
            if (validator) {
                return validator(parsedData);
            }
            return parsedData as T;
        } catch (e: any) {
            throw new Error(`Failed to parse and validate JSON: ${e.message}`);
        }
    };

    const generate = async (opts: JsonGenOptions<any> & { isJsonMode: boolean }): Promise<any> => {
        return withRetries(async () => {
            let apiUrl = "";
            let requestBody: any = {};
            let headers: Record<string, string> = {};

            switch (vendor) {
                case "gemini": {
                    apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
                    headers = { "Content-Type": "application/json" };
                    requestBody = {
                        contents: [{ role: "user", parts: [{ text: opts.user }] }],
                        generationConfig: {
                            temperature,
                            topP: top_p,
                            responseMimeType: opts.isJsonMode ? "application/json" : "text/plain",
                        },
                        ...(opts.system && {
                            systemInstruction: { parts: [{ text: opts.system }] },
                        }),
                    };
                    break;
                }
                case "openai": {
                    apiUrl = "https://api.openai.com/v1/chat/completions";
                    headers = {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${apiKey}`,
                    };
                    const model = "gpt-4.1-2025-04-14";
                    const isReasoning = isOpenAIReasoningModel(model);
                    const messages = [
                        ...(opts.system ? [{ role: "system", content: opts.system }] : []),
                        { role: "user", content: opts.user },
                    ];
                    if (isReasoning) {
                        requestBody = {
                            model,
                            messages,
                            temperature: 1,
                            max_completion_tokens: 8000,
                        };
                    } else {
                        requestBody = {
                            model,
                            messages,
                            temperature,
                            top_p,
                            ...(opts.isJsonMode ? { response_format: { type: "json_object" } } : {}),
                        };
                    }
                    break;
                }
                case "anthropic": {
                    apiUrl = "/api/anthropic";
                    headers = {
                        "Content-Type": "application/json",
                        "x-api-key": apiKey,
                        "anthropic-version": "2023-06-01",
                    };
                      requestBody = {
                        model: "claude-sonnet-4-20250514",
                        max_tokens: 4096,
                        messages: [{ role: "user", content: opts.user }],
                        temperature,
                        top_p,
                    };

                    if (opts.system) {
                        requestBody.system = opts.system;
                    }

                    break;
                }
                default:
                    throw new Error(`Unsupported vendor: ${vendor}`);
            }

            const response = await fetch(apiUrl, {
                method: "POST",
                headers,
                body: JSON.stringify(requestBody),
                signal: opts.signal,
            });

            if (!response.ok) {
                const errBody = await response.text();
                throw new Error(`API request failed: ${response.status} - ${errBody}`);
            }

            const data = await response.json();
            let text = "";
            switch (vendor) {
                case "gemini":
                    text = data.candidates[0].content.parts[0].text;
                    break;
                case "openai":
                    text = data.choices[0].message.content;
                    break;
                case "anthropic":
                    text = data.content[0].text;
                    break;
            }
            return text;
        });
    };

    return {
        generateJSON: async <T,>(opts: JsonGenOptions<T>): Promise<T> => {
            const text = await generate({ ...opts, isJsonMode: true });
            return safeParseJson(text, opts.validator);
        },
        generateText: async (opts: Omit<JsonGenOptions<any>, 'validator'>): Promise<string> => {
            return generate({ ...opts, isJsonMode: false } as any);
        },
    };
}


// --- ICONS ---
const Icon = ({ path, className = "w-6 h-6" }: { path: string, className?: string }) => ( <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}><path d={path} /></svg>);
const ICONS = { /* ... content unchanged ... */ };

// --- MAIN COMPONENT ---
const AgreeIIWorkflow: React.FC = () => {
    // ... state definitions unchanged ...
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


    const steps = [ /* ... content unchanged ... */ ];
    React.useEffect(() => { /* ... content unchanged ... */ }, []);
    async function extractPdfPages(file: File): Promise<{ id: number; page: number; text: string }[]> { /* ... content unchanged ... */ }
    const handleCancel = () => { /* ... content unchanged ... */ };
    const runCancellableProcess = async (processFunction: (signal: AbortSignal) => Promise<void>) => { /* ... content unchanged ... */ };
    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => { /* ... content unchanged ... */ };
    const generateDigest = () => runCancellableProcess(async (signal) => { /* ... content unchanged ... */ });

    // MODIFIED: This function now calculates and stores the domain score.
    const evaluateDomains = () => runCancellableProcess(async (signal) => {
        if (!searchIndex) {
            throw new Error("Search index is not available.");
        }
        setResults(prev => ({ ...prev, domains: {} }));
        const domainPrompts = AGREE_II_PROMPT_PACK.prompts.domain_prompts;
        const client = getClient(selectedLlm, apiKeys[selectedLlm]);

        const scoreDomain = async (domainConfig: typeof domainPrompts[0]) => {
            if (signal.aborted) throw new Error('Aborted');
            setProcessingStatus(`Evaluating Domain ${domainConfig.domain}: ${domainConfig.name}...`);
            
            const searchResults = searchIndex.search(domainConfig.keywords, { prefix: true, fuzzy: 0.2 });
            const evidenceSnippets = searchResults.slice(0, 5).map(result => ({
                snippet: result.text.slice(0, 1000),
                pages: [result.page]
            }));

            const digestSlice = {
                scope_purpose: results.digest?.scope_purpose,
                stakeholders: results.digest?.stakeholders,
                rigour: results.digest?.rigour,
                clarity: results.digest?.clarity,
                applicability: results.digest?.applicability,
                editorial_independence: results.digest?.editorial_independence,
            };
            const domainPrompt = domainConfig.prompt
                .replace('<DIGEST>{...domain-relevant fields only...}</DIGEST>', `<DIGEST>${JSON.stringify(digestSlice, null, 2)}</DIGEST>`)
                .replace('<EVIDENCE>[{\"snippet\":\"...\", \"pages\":[...]}]</EVIDENCE>', `<EVIDENCE>${JSON.stringify(evidenceSnippets, null, 2)}</EVIDENCE>`);

            const domainItems = await client.generateJSON({
                user: domainPrompt,
                system: AGREE_II_PROMPT_PACK.prompts.system_prompt,
                validator: validators.domainResult,
                signal,
            });

            // NEW: Calculate the score after getting the item results
            const calculated_score = calculateDomainScore(domainItems, domainConfig);

            if (signal.aborted) throw new Error('Aborted');
            setResults(prev => ({
                ...prev,
                domains: {
                    ...prev.domains,
                    [domainConfig.domain as DomainId]: { 
                        name: domainConfig.name, 
                        items: domainItems,
                        calculated_score // Store the calculated score
                    }
                }
            }));
        };

        await mapLimit(domainPrompts, 2, scoreDomain);
        if (signal.aborted) return;
        setProcessingStatus('All domains evaluated.');
        setCurrentStep(3);
    });
    
    const generateOverallAssessment = () => runCancellableProcess(async (signal) => { /* ... content unchanged ... */ });
    const downloadResults = () => { /* ... content unchanged ... */ };
    const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => { /* ... content unchanged ... */ };

    // --- UI Components ---
    const StepIndicator = ({ /* ... */ }) => ( /* ... content unchanged ... */ );
    const ApiKeyManager = () => ( /* ... content unchanged ... */ );

    // MODIFIED: The final results step (`case 4`) now displays the calculated score.
    const renderStepContent = () => {
        const totalChars = guidelinePages.reduce((acc, p) => acc + p.text.length, 0);
        const areLibrariesReady = isPdfJsReady && isMiniSearchReady;
        switch (currentStep) {
            case 0:
                 return ( /* ... content unchanged ... */ );
            case 1:
                return ( /* ... content unchanged ... */ );
            case 2:
                return ( /* ... content unchanged ... */ );
            case 3:
                return ( /* ... content unchanged ... */ );
            case 4: // <<< MODIFIED STEP
                return (
                    <div className="w-full">
                        <div className="text-center">
                            <h2 className="text-2xl font-semibold mb-2">Assessment Complete</h2>
                            <p className="text-gray-600 mb-6">Review the full AGREE II assessment results below or download the complete JSON file.</p>
                        </div>

                        <div className="mb-8 p-6 bg-blue-50 border border-blue-200 rounded-lg text-left max-w-3xl mx-auto shadow-md">
                            {/* ... overall assessment content unchanged ... */}
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
                                                {/* NEW: Display the calculated score */}
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
                            {/* ... download button content unchanged ... */}
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
                { /* ... rest of the component unchanged ... */ }
            </div>
        </div>
    );
};

export default AgreeIIWorkflow;
