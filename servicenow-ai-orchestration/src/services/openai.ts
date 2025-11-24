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

  private async callOpenAI(messages: OpenAIMessage[]): Promise<string> {
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
        max_tokens: this.maxTokens,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'OpenAI API error');
    }

    const data: OpenAIResponse = await response.json();
    return data.choices[0]?.message?.content || '';
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
