import type {
  DocumentClassification,
  DocumentType,
  ExtractedData,
  ExtractedEntity,
  Vendor,
  Supplier,
  Contract,
  PurchaseOrder,
  ExpenseLine,
  PurchaseOrderLine,
  DuplicatePair,
  DuplicateSeverity,
} from '../types';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export class OpenAIService {
  private apiKey: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(
    apiKey: string,
    model: string = 'gpt-4',
    temperature: number = 0.3,
    maxTokens: number = 4096
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
  }

  private async callOpenAI(messages: OpenAIMessage[], maxTokensOverride?: number): Promise<string> {
    // Cap max_tokens to prevent API errors
    const effectiveMaxTokens = Math.min(maxTokensOverride || this.maxTokens, 4096);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: this.temperature,
        max_tokens: effectiveMaxTokens,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'OpenAI API error');
    }

    const data: OpenAIResponse = await response.json();
    let content = data.choices[0]?.message?.content || '';

    // Strip markdown code blocks if present
    if (content.startsWith('```json')) {
      content = content.slice(7);
    } else if (content.startsWith('```')) {
      content = content.slice(3);
    }
    if (content.endsWith('```')) {
      content = content.slice(0, -3);
    }
    return content.trim();
  }

  async classifyDocument(text: string): Promise<DocumentClassification> {
    const systemPrompt = `You are a document classification expert specializing in procurement documents.
Analyze the provided document text and classify it into one of these categories:
- contract: A formal agreement, statement of work, service agreement, or master service agreement
- amendment: A modification, renewal, or addendum to an existing contract
- purchase_order: A formal order to purchase goods or services
- invoice: A bill for goods or services
- unknown: Cannot determine the document type

Respond with a JSON object containing:
- type: one of "contract", "amendment", "purchase_order", "invoice", "unknown"
- confidence: a number between 0 and 100 indicating your confidence
- reasoning: a brief explanation of why you classified it this way

Only respond with the JSON object, no other text.`;

    const userPrompt = `Classify this document:\n\n${text.substring(0, 8000)}`;

    try {
      const response = await this.callOpenAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      const parsed = JSON.parse(response);
      return {
        type: parsed.type as DocumentType,
        confidence: parsed.confidence,
        reasoning: parsed.reasoning,
      };
    } catch (error) {
      console.error('Classification error:', error);
      return {
        type: 'unknown',
        confidence: 0,
        reasoning: 'Failed to classify document',
      };
    }
  }

  async extractContractData(text: string): Promise<{
    vendor: Partial<Vendor>;
    contract: Partial<Contract>;
    expenseLines: Partial<ExpenseLine>[];
    rawEntities: ExtractedEntity[];
  }> {
    const systemPrompt = `You are a data extraction expert specializing in procurement contracts.
Extract structured information from the contract document. Look for:

VENDOR INFORMATION:
- name: Company/vendor name
- website: Company website URL
- street, city, state, country: Address components
- vendor_type: Type of vendor (e.g., "Software", "Services", "Hardware")

CONTRACT INFORMATION:
- short_description: Brief contract title/description
- description: Detailed description
- starts: Contract start date (format: YYYY-MM-DD HH:mm:ss)
- ends: Contract end date (format: YYYY-MM-DD HH:mm:ss)
- payment_amount: Total payment amount (numeric only)
- payment_schedule: Payment frequency (e.g., "Annual", "Monthly", "Quarterly")
- invoice_payment_terms: Payment terms (e.g., "Net 30", "Net 60")
- u_payment_method: Payment method (e.g., "Invoice", "Credit Card")
- renewable: Whether contract is renewable ("true" or "false")
- contract_model: Type of contract - one of: "Software License", "Subscription", "Service Agreement", "Lease"
- vendor_contract: The vendor's contract reference number or identifier if mentioned

EXPENSE LINES (array of line items):
- amount: Amount for this line item
- short_description: Description of the line item

For each extracted field, provide a confidence score (0-100).

Respond with a JSON object:
{
  "vendor": { field: value, ... },
  "contract": { field: value, ... },
  "expenseLines": [ { amount, short_description }, ... ],
  "rawEntities": [ { field: string, value: string, confidence: number, source: string }, ... ]
}

Only respond with the JSON object, no other text.`;

    try {
      const response = await this.callOpenAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Extract data from this contract:\n\n${text.substring(0, 12000)}` },
      ]);

      return JSON.parse(response);
    } catch (error) {
      console.error('Contract extraction error:', error);
      return {
        vendor: {},
        contract: {},
        expenseLines: [],
        rawEntities: [],
      };
    }
  }

  async extractPurchaseOrderData(text: string): Promise<{
    supplier: Partial<Supplier>;
    purchaseOrder: Partial<PurchaseOrder>;
    purchaseOrderLines: Partial<PurchaseOrderLine>[];
    rawEntities: ExtractedEntity[];
  }> {
    const systemPrompt = `You are a data extraction expert specializing in purchase orders.
Extract structured information from the purchase order document. Look for:

SUPPLIER INFORMATION:
- name: Supplier company name
- legal_name: Legal entity name if different
- web_site: Supplier website
- street, city, state, country, zip: Address components

PURCHASE ORDER INFORMATION:
- display_name: PO name/title
- status: PO status
- total_amount: Total PO amount (numeric only)
- purchase_order_type: Type of PO
- created: PO date (format: YYYY-MM-DD HH:mm:ss)

PO LINES (array of line items):
- product_name: Name of the product/service
- short_description: Description
- purchased_quantity: Quantity ordered
- unit_price: Price per unit (format: "USD;123.45")
- total_line_amount: Total for this line (format: "USD;123.45")

For each extracted field, provide a confidence score (0-100).

Respond with a JSON object:
{
  "supplier": { field: value, ... },
  "purchaseOrder": { field: value, ... },
  "purchaseOrderLines": [ { product_name, short_description, purchased_quantity, unit_price, total_line_amount }, ... ],
  "rawEntities": [ { field: string, value: string, confidence: number, source: string }, ... ]
}

Only respond with the JSON object, no other text.`;

    try {
      const response = await this.callOpenAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Extract data from this purchase order:\n\n${text.substring(0, 12000)}` },
      ]);

      return JSON.parse(response);
    } catch (error) {
      console.error('PO extraction error:', error);
      return {
        supplier: {},
        purchaseOrder: {},
        purchaseOrderLines: [],
        rawEntities: [],
      };
    }
  }

  async extractFullDocument(
    text: string,
    documentType: DocumentType
  ): Promise<ExtractedData> {
    // First, classify if not already determined
    let classification: DocumentClassification;
    if (documentType === 'unknown') {
      classification = await this.classifyDocument(text);
      documentType = classification.type;
    } else {
      classification = {
        type: documentType,
        confidence: 100,
        reasoning: 'Document type was specified by user',
      };
    }

    // Extract based on document type
    if (documentType === 'contract' || documentType === 'amendment') {
      const extracted = await this.extractContractData(text);
      return {
        documentType,
        classification,
        vendor: extracted.vendor,
        contract: extracted.contract,
        expenseLines: extracted.expenseLines,
        rawEntities: extracted.rawEntities,
      };
    } else if (documentType === 'purchase_order' || documentType === 'invoice') {
      const extracted = await this.extractPurchaseOrderData(text);
      return {
        documentType,
        classification,
        supplier: extracted.supplier,
        purchaseOrder: extracted.purchaseOrder,
        purchaseOrderLines: extracted.purchaseOrderLines,
        rawEntities: extracted.rawEntities,
      };
    }

    // Unknown document type - try to extract what we can
    return {
      documentType: 'unknown',
      classification,
      rawEntities: [],
    };
  }

  /**
   * Extract contract fields from a document for updating an existing contract
   * Returns only the fields that should be updated with their extracted values
   */
  async extractContractFieldsForUpdate(text: string): Promise<{
    fields: Partial<Contract>;
    confidence: Record<string, number>;
    suggestions: string[];
  }> {
    const systemPrompt = `You are a data extraction expert specializing in contract documents.
Extract structured information from the provided document to update an existing contract record.

Extract these fields if found in the document:
- short_description: Brief contract title/description
- description: Detailed description of the contract
- starts: Contract start date (format: YYYY-MM-DD)
- ends: Contract end date (format: YYYY-MM-DD)
- payment_amount: Total payment/contract amount (numeric value only, no currency symbols)
- payment_schedule: Payment frequency (e.g., "Annual", "Monthly", "Quarterly", "One-time")
- invoice_payment_terms: Payment terms (e.g., "Net 30", "Net 60", "Due on Receipt")
- u_payment_method: Payment method (e.g., "Invoice", "Credit Card", "Wire Transfer", "Check")
- renewable: Whether contract is renewable ("true" or "false")
- contract_model: Type of contract - one of: "Software License", "Subscription", "Service Agreement", "Lease", "Maintenance"
- vendor_contract: The vendor's contract reference number or identifier
- total_cost: Total contract cost (numeric value only)
- monthly_cost: Monthly cost if applicable (numeric value only)
- yearly_cost: Yearly/annual cost if applicable (numeric value only)

IMPORTANT RULES:
1. Only include fields that are CLEARLY mentioned in the document
2. Do NOT guess or infer values - only extract explicitly stated information
3. For dates, convert to YYYY-MM-DD format
4. For monetary values, extract only the numeric value (e.g., "50000" not "$50,000")
5. For each field you extract, provide a confidence score (0-100)

Respond with a JSON object:
{
  "fields": { field_name: extracted_value, ... },
  "confidence": { field_name: confidence_score, ... },
  "suggestions": ["list of suggestions or warnings about the extraction"]
}

Only respond with the JSON object, no other text.`;

    try {
      const response = await this.callOpenAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Extract contract fields from this document:\n\n${text.substring(0, 12000)}` },
      ]);

      const parsed = JSON.parse(response);
      return {
        fields: parsed.fields || {},
        confidence: parsed.confidence || {},
        suggestions: parsed.suggestions || [],
      };
    } catch (error) {
      console.error('Contract field extraction error:', error);
      return {
        fields: {},
        confidence: {},
        suggestions: ['Failed to extract fields from document'],
      };
    }
  }

  async suggestMatches(
    entityType: 'vendor' | 'supplier' | 'contract',
    extractedData: Record<string, unknown>,
    existingRecords: Array<Record<string, unknown>>
  ): Promise<Array<{ record: Record<string, unknown>; confidence: number; reason: string }>> {
    const systemPrompt = `You are a data matching expert. Given extracted data from a document and a list of existing records,
identify which existing records might be matches.

For each potential match, provide:
- The matching record
- A confidence score (0-100)
- A reason explaining why it's a match

Consider:
- Name variations (abbreviations, alternate spellings)
- Address similarities
- Website domain matches
- Business registration numbers

Return a JSON array of matches, sorted by confidence (highest first).
Only include matches with confidence > 50.
Return empty array if no matches found.

Format: [ { "recordIndex": number, "confidence": number, "reason": string }, ... ]`;

    try {
      const response = await this.callOpenAI([
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Find matches for this ${entityType}:

Extracted Data:
${JSON.stringify(extractedData, null, 2)}

Existing Records:
${JSON.stringify(existingRecords.slice(0, 20), null, 2)}`,
        },
      ]);

      const matches = JSON.parse(response);
      return matches.map((m: { recordIndex: number; confidence: number; reason: string }) => ({
        record: existingRecords[m.recordIndex],
        confidence: m.confidence,
        reason: m.reason,
      }));
    } catch (error) {
      console.error('Match suggestion error:', error);
      return [];
    }
  }

  /**
   * AI-powered duplicate contract detection
   * Analyzes a list of contracts and identifies potential duplicates using semantic analysis
   */
  async detectDuplicateContracts(
    contracts: Array<Record<string, unknown>>,
    onProgress?: (progress: number, message: string) => void
  ): Promise<{
    pairs: DuplicatePair[];
    totalAnalyzed: number;
  }> {
    const systemPrompt = `You are an expert at identifying duplicate or near-duplicate contracts in enterprise systems.
Analyze the provided list of contracts and identify pairs that are likely duplicates or near-duplicates.

Consider these factors when identifying duplicates:
1. **Vendor Match**: Same or similar vendor names (account for abbreviations, typos, alternate names)
2. **Description Similarity**: Similar short_description or contract subject matter
3. **Date Overlap**: Overlapping contract periods (starts/ends dates)
4. **Value Similarity**: Similar payment_amount or total_cost values
5. **Contract Number Patterns**: Similar numbering patterns that might indicate duplicates
6. **State Conflicts**: Multiple active contracts for same vendor/service

For each duplicate pair found, provide:
- index1, index2: The indices of the two contracts in the input array
- similarity: A score from 0-100 indicating how likely they are duplicates
- severity: "high" (>80% likely duplicate), "medium" (60-80%), or "low" (40-60%)
- matchedFields: Array of field names that match or are similar
- reasoning: Detailed explanation of why these appear to be duplicates
- suggestedAction: One of:
  - "merge": Records should be merged (keep data from both)
  - "delete_first": Delete the first contract (older/less complete)
  - "delete_second": Delete the second contract (older/less complete)
  - "keep_both": Both are valid but similar (not duplicates)
  - "review": Needs human review to determine

IMPORTANT:
- Only report pairs with similarity >= 40%
- Be conservative - only flag true potential duplicates
- Consider business context (it's valid to have multiple contracts with same vendor for different services)
- Look for data quality issues like partial duplicates or data entry errors

Respond with a JSON object:
{
  "duplicatePairs": [
    {
      "index1": number,
      "index2": number,
      "similarity": number,
      "severity": "high" | "medium" | "low",
      "matchedFields": ["field1", "field2", ...],
      "reasoning": "explanation...",
      "suggestedAction": "merge" | "delete_first" | "delete_second" | "keep_both" | "review"
    }
  ],
  "summary": "Brief summary of findings"
}

Only respond with the JSON object, no other text.`;

    const duplicatePairs: DuplicatePair[] = [];
    const batchSize = 15; // Process contracts in batches
    const totalBatches = Math.ceil(contracts.length / batchSize);

    try {
      // Process in batches for large datasets
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const startIdx = batchIndex * batchSize;
        const endIdx = Math.min(startIdx + batchSize, contracts.length);
        const batch = contracts.slice(startIdx, endIdx);

        const progress = Math.round(((batchIndex + 1) / totalBatches) * 100);
        onProgress?.(progress, `Analyzing batch ${batchIndex + 1} of ${totalBatches}...`);

        // Prepare contract data - minimal fields to reduce tokens
        const contractsForAnalysis = batch.map((c, idx) => {
          const getVal = (field: unknown): string => {
            if (typeof field === 'object' && field !== null) {
              return (field as { display_value?: string })?.display_value || '';
            }
            return String(field || '');
          };
          return {
            i: startIdx + idx,
            num: getVal(c.number),
            desc: getVal(c.short_description)?.substring(0, 100),
            vendor: getVal(c.vendor),
            starts: getVal(c.starts),
            ends: getVal(c.ends),
            cost: getVal(c.total_cost) || getVal(c.payment_amount),
            state: getVal(c.state),
          };
        });

        const response = await this.callOpenAI([
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Find duplicates in these contracts:\n${JSON.stringify(contractsForAnalysis)}`,
          },
        ], 2048);

        const result = JSON.parse(response);

        if (result.duplicatePairs && Array.isArray(result.duplicatePairs)) {
          for (const pair of result.duplicatePairs) {
            const contract1 = contracts[pair.index1];
            const contract2 = contracts[pair.index2];

            if (!contract1 || !contract2) continue;

            const getFieldValue = (record: Record<string, unknown>, field: string): string => {
              const value = record[field];
              if (typeof value === 'object' && value !== null) {
                return (value as { display_value?: string; value?: string })?.display_value ||
                       (value as { value?: string })?.value || '';
              }
              return String(value || '');
            };

            const getSysId = (record: Record<string, unknown>): string => {
              const sysId = record.sys_id;
              if (typeof sysId === 'object' && sysId !== null) {
                return (sysId as { value?: string })?.value || '';
              }
              return String(sysId || '');
            };

            const sysId1 = getSysId(contract1);
            const sysId2 = getSysId(contract2);

            // Skip if sys_ids are invalid
            if (!sysId1 || !sysId2) continue;

            // Avoid duplicate pairs (A-B and B-A)
            const existingPair = duplicatePairs.find(
              (p) =>
                (p.contract1.sys_id === sysId1 && p.contract2.sys_id === sysId2) ||
                (p.contract1.sys_id === sysId2 && p.contract2.sys_id === sysId1)
            );
            if (existingPair) continue;

            duplicatePairs.push({
              id: `dup_${sysId1}_${sysId2}`,
              contract1: {
                sys_id: sysId1,
                number: getFieldValue(contract1, 'number'),
                short_description: getFieldValue(contract1, 'short_description'),
                vendor: getFieldValue(contract1, 'vendor'),
                starts: getFieldValue(contract1, 'starts'),
                ends: getFieldValue(contract1, 'ends'),
                total_cost: getFieldValue(contract1, 'total_cost') || getFieldValue(contract1, 'payment_amount'),
                state: getFieldValue(contract1, 'state'),
                raw: contract1,
              },
              contract2: {
                sys_id: sysId2,
                number: getFieldValue(contract2, 'number'),
                short_description: getFieldValue(contract2, 'short_description'),
                vendor: getFieldValue(contract2, 'vendor'),
                starts: getFieldValue(contract2, 'starts'),
                ends: getFieldValue(contract2, 'ends'),
                total_cost: getFieldValue(contract2, 'total_cost') || getFieldValue(contract2, 'payment_amount'),
                state: getFieldValue(contract2, 'state'),
                raw: contract2,
              },
              similarity: pair.similarity,
              severity: pair.severity as DuplicateSeverity,
              matchedFields: pair.matchedFields || [],
              aiReasoning: pair.reasoning,
              suggestedAction: pair.suggestedAction,
            });
          }
        }
      }

      // Sort by severity and similarity
      duplicatePairs.sort((a, b) => {
        const severityOrder = { high: 0, medium: 1, low: 2 };
        if (severityOrder[a.severity] !== severityOrder[b.severity]) {
          return severityOrder[a.severity] - severityOrder[b.severity];
        }
        return b.similarity - a.similarity;
      });

      return {
        pairs: duplicatePairs,
        totalAnalyzed: contracts.length,
      };
    } catch (error) {
      console.error('Duplicate detection error:', error);
      throw error;
    }
  }
}

// Singleton instance
let openaiInstance: OpenAIService | null = null;

export function getOpenAIService(
  apiKey?: string,
  model?: string,
  temperature?: number,
  maxTokens?: number
): OpenAIService {
  if (!openaiInstance && apiKey) {
    openaiInstance = new OpenAIService(apiKey, model, temperature, maxTokens);
  }
  if (!openaiInstance) {
    throw new Error('OpenAI service not initialized. Please configure your API key.');
  }
  return openaiInstance;
}

export function initOpenAIService(
  apiKey: string,
  model?: string,
  temperature?: number,
  maxTokens?: number
): OpenAIService {
  openaiInstance = new OpenAIService(apiKey, model, temperature, maxTokens);
  return openaiInstance;
}

export function resetOpenAIService(): void {
  openaiInstance = null;
}
