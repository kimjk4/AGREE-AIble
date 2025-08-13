# AGREE-AIble: the AGREE II Guideline Assessment Automation

This document explains the purpose and inner workings of the AGREE-AIble. It's designed for everyone, including those without a technical background.

**What Does This App Do?**
At its core, this application is an AI-powered assistant for reviewing clinical guidelines. It uses the official AGREE II instrument—a globally recognized checklist for assessing the quality and rigor of medical guidelines—to automate the appraisal process.

A user can upload a clinical guideline document (as a PDF or text file), and the app will use a powerful AI model to read, analyze, and score it against the 23 criteria of the AGREE II standard. The goal is to make the time-consuming process of guideline appraisal faster, more consistent, and more accessible.

How the Code is Structured (In Simple Terms)
Think of the application as a highly organized workshop with specialized experts who work together.

**1. The "Brain": The Prompt Pack**
The entire process is guided by a central rulebook called the AGREE_II_PROMPT_PACK. This is a detailed set of instructions we've written for the AI. It contains:

- System Rules: The main personality and rules for the AI (e.g., "You are an AGREE II appraiser," "Judge only what is reported," "Score from 1-7").
- Specific Tasks: Step-by-step instructions for each part of the process, like creating an initial summary (the "Digest") and scoring each of the six AGREE II domains.
- Keywords for Searching: For each domain, we've included a list of keywords (e.g., for "Rigour of Development," it knows to look for words like "search," "database," and "evidence").

This ensures that no matter which AI model we use, it always follows the same strict methodology.

**2. The "Universal Translator": The Model Abstraction**
We want the app to be able to use different AI models (like Google's Gemini, OpenAI's GPT-4o, or Anthropic's Claude). However, each of these models speaks a slightly different "language" in terms of code.

The getClient function acts as a universal translator. When the user selects a model from the dropdown, this function creates a standardized "client" that knows how to talk to that specific model. This keeps the main application logic clean and simple—it just gives a command to the translator, and the translator handles the specific details for each AI vendor.

**3. The "Librarians": PDF Reading and Searching**
When a PDF is uploaded, two "librarians" get to work:

- The Reader (pdf.js): This tool carefully reads the PDF, page by page. It understands the document's structure and knows exactly which text belongs to which page number. This is crucial for accurate citations.
- The Indexer (MiniSearch): Once the text is extracted, this tool quickly creates a searchable index of the entire document, like a book's index but much more powerful. When the app needs to find information about "funding" or "patient involvement," the indexer knows exactly which pages to look at.

This two-step process ensures that when the AI is asked to score a specific domain, it is only given the most relevant pages to read, which prevents it from getting confused or making up information.

**4. The "Director": The Main App Component**
The AgreeIIWorkflow component is the director of the entire operation. It manages the user interface and coordinates the work of all the other parts. It keeps track of:
- The current step in the 5-step process.
- The uploaded file and its extracted text.
- The results as they come in from the AI.
- The user's choice of AI model and their API key.

The director ensures that everything happens in the right order and provides clear feedback to the user along the way, such as status messages, loading indicators, and error alerts.

**The User's Journey (The 5-Step Workflow)**
From the user's perspective, the process is a simple, five-step journey:

1. Upload Guideline: You provide the app with the document you want to assess. The app's "librarians" immediately read and index it.

2. Generate Digest: The AI takes a first pass over the entire document to create a high-level, structured summary. This helps the AI understand the guideline's overall content before diving into the details.

3. Evaluate Domains: This is the core of the work. For each of the six AGREE II domains, the app:
- Uses its search index to find the most relevant pages.
- Sends only those relevant pages to the AI, along with the specific questions for that domain.
- Receives a structured JSON score back from the AI.
- This happens in parallel (two domains at a time) to speed up the process.

4. Overall Assessment: Once all domains are scored, the AI is asked to provide a final, overall quality score and a recommendation on whether to use the guideline.

5. Download Results: You receive a complete, structured JSON file containing the full assessment, which can be saved for your records.
