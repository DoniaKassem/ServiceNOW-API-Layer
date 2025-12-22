# ServiceNow AI Ingestion & Request Orchestration Application

## Build Directive

You are building a full-stack web application from scratch. This application serves as an intelligent orchestration layer that bridges document processing, AI-powered entity extraction, and ServiceNow's REST APIs. The goal is to transform unstructured procurement documents into validated, auditable ServiceNow records while keeping humans in complete control of every API interaction.

You have access to three Postman collection files that define the exact ServiceNow API contracts you must implement against. Parse these files to extract endpoint URLs, HTTP methods, headers, request body schemas, and query parameters. These collections are your source of truth for ServiceNow integration.

**Reference Files:**
- `ServiceNow_Get_Requests_postman_collection.json` — Read operations for suppliers, models, offerings, and contract-asset relationships
- `ServiceNow_Post_Requests_postman_collection.json` — Create operations for all procurement entities
- `ServiceNow_Patch_Requests_postman_collection.json` — Update operations for existing records

---

## Application Purpose

Procurement teams receive contracts, purchase orders, invoices, and amendments in inconsistent formats. This application automates the heavy lifting of extracting structured data from these documents and preparing ServiceNow API requests, while ensuring that no data reaches ServiceNow without explicit human review and approval.

The application must feel like a control tower: users upload documents, watch the AI interpret them, inspect every proposed field mapping, modify anything they disagree with, and only then authorize transmission to ServiceNow.

---

## Technology Stack Guidance

Build this as a modern React application with TypeScript. Use a component library that supports complex data tables, form builders, and split-pane layouts. The backend should handle OCR processing, OpenAI API calls, and act as a secure proxy for ServiceNow credentials. Consider Supabase or a similar backend-as-a-service for authentication and state persistence.

---

## ServiceNow Schema Reference

The Postman collections define the following tables and their field structures. Parse the collections for exact field names, but here is the conceptual model:

### Entity Hierarchy

```
Vendor (core_company)
    └── Supplier (sn_fin_supplier) — linked via u_vendor field
            └── Contract (ast_contract) — references vendor and supplier
                    ├── Expense Lines (fm_expense_line) — references contract
                    ├── Covered Assets (clm_m2m_contract_asset) — join table
                    └── Service Offerings (service_offering) — references vendor
            └── Purchase Order (sn_shop_purchase_order) — references supplier
                    └── PO Lines (sn_shop_purchase_order_line) — references purchase_order
                            └── Currency Instances (fx_currency2_instance) — for unit_price, total_line_amount
```

### Key Tables and Their Roles

**core_company** — The vendor master record. When the `vendor` boolean is true, this company can be referenced in contracts and linked to suppliers.

**sn_fin_supplier** — Financial supplier record used in procurement workflows. Links to a vendor via the `u_vendor` reference field. Purchase orders reference suppliers, not vendors directly.

**ast_contract** — The contract record containing terms, dates, payment schedules, and financial summaries. References both vendor and supplier. Supports states like draft, active, and expired.

**fm_expense_line** — Individual cost line items associated with a contract. Each line can reference a configuration item and holds an amount and description.

**service_offering** — Products or services a vendor provides. Links to vendor via sys_id reference.

**alm_asset** — Physical or logical assets that can be covered by contracts. References a model from cmdb_model.

**clm_m2m_contract_asset** — Many-to-many join table linking contracts to the assets they cover.

**cmdb_model** — Product model definitions in the CMDB. Assets reference models.

**sn_shop_purchase_order** — Purchase order header with supplier reference, status, and total amount.

**sn_shop_purchase_order_line** — Individual line items on a PO. References the parent PO and contains product details, quantities, and pricing.

**fx_currency2_instance** — Currency wrapper records used for monetary fields. PO lines reference these for unit_price and total_line_amount.

**sn_shop_supplier_product** — Catalog of products associated with a supplier.

---

## Workflow Architecture

### Document Classification Phase

When a user uploads a file, the system must first determine what kind of document it is. The AI should classify documents into one of these categories:

- **Contract or Statement of Work** — Route to contract ingestion workflow
- **Amendment or Renewal** — Route to contract update workflow (requires existing contract lookup)
- **Purchase Order** — Route to PO creation workflow
- **Invoice** — Route to PO matching and validation workflow
- **Unknown or Mixed** — Present classification options to user for manual selection

Classification confidence should be displayed to the user. If confidence falls below 80%, pause and ask the user to confirm before proceeding.

### Entity Extraction Phase

After classification, the AI extracts structured entities from the document. The extraction must produce:

**For Contracts:**
- Vendor name, address, website
- Contract dates (start, end, renewal)
- Payment terms and schedule
- Total value and breakdown
- Line-item charges (recurring vs. one-time)
- Referenced products, services, or assets

**For Purchase Orders:**
- Supplier name and details
- PO number and date
- Line items with quantities, unit prices, totals
- Currency information
- Shipping or delivery terms

The extraction output should be presented as editable JSON that the user can modify before the system attempts ServiceNow lookups.

### Matching and Linking Phase

Before creating new records, the system must search ServiceNow for existing matches:

**Vendor Matching:**
1. Query `core_company` with name variations and website domain
2. If exact match found (confidence > 95%), propose linking to existing record
3. If partial match found (confidence 70-95%), present candidates for user selection
4. If no match found (confidence < 70%), propose new vendor creation

**Supplier Matching:**
1. Query `sn_fin_supplier` with name and legal name variations
2. Check if matched vendor already has a linked supplier
3. Present existing supplier or propose creation

**Contract Matching (for amendments):**
1. Query `ast_contract` by vendor, contract number, or date range
2. Present matching contracts for user to select the parent

The matching logic should be transparent. Show the user what search queries were executed, what results came back, and why the system is recommending a particular action.

### Request Generation Phase

For every record that needs to be created or updated, the system generates a complete API request object containing:

- Full URL with base path and table name
- HTTP method (POST for create, PATCH for update)
- Headers including authentication
- Request body with all field mappings

These requests are drafts. The user must be able to:

- View each request in a structured format
- Edit any field value before submission
- Reorder the execution sequence
- Remove requests they don't want to execute
- Duplicate requests for batch scenarios

### Execution Phase

When the user approves a request batch, execute them in dependency order:

1. Vendors first (needed by suppliers and contracts)
2. Suppliers second (needed by POs and contracts)
3. Models and offerings (needed by assets and expense lines)
4. Assets (needed by contract coverage)
5. Contracts or POs (parent records)
6. Expense lines, PO lines, and coverage records last

Capture the sys_id from each successful creation and automatically populate it into dependent requests. If a request fails, halt execution, display the error with ServiceNow's response, and allow the user to fix and retry.

---

## User Interface Specification

### Settings Panel

A configuration area where users establish their environment:

**ServiceNow Connection:**
- Instance base URL (e.g., `https://illumindev.service-now.com`)
- API key input with secure storage
- Connection test button that validates credentials against a simple GET request
- Visual indicator showing connection status

**OpenAI Configuration:**
- API key input
- Model selection (recommend gpt-4 for accuracy)
- Temperature and token limit controls for advanced users

**Default Behaviors:**
- Default vendor manager name
- Default contract administrator
- Preferred currency code
- Auto-save draft requests toggle

### Document Processing View

The primary workspace for ingestion:

**Upload Zone:**
- Drag-and-drop area accepting PDF, DOCX, images
- File preview showing uploaded document
- OCR status indicator with progress

**Classification Panel:**
- Detected document type with confidence score
- Override dropdown if user disagrees
- Workflow selection buttons (Contract, PO, Manual)

**Extraction Results:**
- Structured tree view of extracted entities
- Inline editing for any value
- Confidence indicators per field (color-coded)
- Missing field warnings

### Request Console

The command center for API interactions:

**Request Queue:**
- List of all pending requests with type badges (Vendor, Contract, PO, etc.)
- Dependency visualization showing execution order
- Drag-and-drop reordering within valid dependency constraints
- Bulk select and delete

**Request Inspector:**
- Selected request displayed in full detail
- Tabbed view: URL & Method | Headers | Body | Response
- Syntax-highlighted JSON with inline editing
- Field-level validation warnings
- Diff view showing AI-proposed vs. user-modified values

**Execution Controls:**
- Execute Selected button
- Execute All (Approved) button
- Dry Run mode that validates without sending
- Execution log with timestamps and response codes

### Field Audit Panel

A validation layer ensuring data quality:

**Schema Comparison:**
- Side-by-side view of extracted fields vs. ServiceNow table schema
- Highlighting for missing required fields
- Warnings for type mismatches (string vs. reference, date format issues)

**Reference Validation:**
- For every sys_id reference field, show whether the referenced record exists
- Link to open the referenced record in ServiceNow (new tab)

**Naming Convention Checks:**
- Flag fields that don't match expected patterns (e.g., contract numbers)
- Suggest corrections based on existing data patterns

---

## Error Handling and Recovery

### ServiceNow Error Responses

When ServiceNow returns an error, the system must:

1. Parse the error response body for the specific failure reason
2. Map common error codes to user-friendly explanations:
   - **401 Unauthorized** — API key is invalid or expired; prompt user to check settings
   - **403 Forbidden** — User lacks permissions for this table; list required roles
   - **400 Bad Request** — Field validation failed; highlight the problematic field(s)
   - **404 Not Found** — Record or table doesn't exist; verify sys_id or table name
   - **409 Conflict** — Duplicate key or business rule violation; explain the constraint
   - **429 Too Many Requests** — Rate limited; implement exponential backoff
3. Offer one-click retry after user makes corrections
4. Log all failures for troubleshooting

### Partial Success Handling

When executing a batch and some requests succeed while others fail:

1. Mark successful requests as complete with their new sys_ids
2. Update dependent requests with the new sys_ids where applicable
3. Halt at the first failure and show which requests remain
4. Allow user to fix the failed request and resume from that point
5. Never require re-executing already-successful requests

### Data Validation Failures

When the AI extracts data that doesn't pass validation:

1. Highlight the field in the extraction results
2. Explain what's wrong (e.g., "Date format must be YYYY-MM-DD")
3. Offer auto-correction if the fix is obvious
4. Block request generation until critical fields are valid

---

## State and Session Management

### Draft Persistence

The application should automatically save work in progress:

- Save extraction results after OCR completes
- Save user edits to extracted data
- Save the request queue state
- Save execution history with responses

If the user closes the browser and returns, they should be able to resume from where they left off.

### Session Organization

Provide a way to organize work:

- Each document upload starts a new "ingestion session"
- Sessions are named by document filename and timestamp
- Users can view past sessions and their outcomes
- Sessions can be marked as complete, in-progress, or failed

### Audit Trail

Every action should be logged:

- Document upload timestamps
- Classification decisions
- Field edits with before/after values
- Request execution attempts and outcomes
- User who performed each action (if multi-user)

---

## Scope Boundaries

### What This Application Does

- Extracts structured data from procurement documents
- Matches entities to existing ServiceNow records
- Generates ServiceNow API requests for review
- Executes approved requests with proper dependency ordering
- Tracks outcomes and maintains audit history

### What This Application Does Not Do

- Automatically submit requests without user approval (no auto-execution)
- Modify existing ServiceNow records without explicit user selection of update mode
- Store ServiceNow credentials in plain text or client-side storage
- Process documents containing sensitive data without user acknowledgment
- Make assumptions about data when extraction confidence is low
- Execute requests in parallel (dependency order must be respected)

---

## Success Criteria

The application is complete when a user can:

1. Upload a contract PDF and see it classified correctly
2. Review AI-extracted vendor, contract, and line-item data
3. Edit any extracted value that the AI got wrong
4. See the system find (or not find) matching vendors in ServiceNow
5. Approve the creation of a new vendor, contract, and expense lines
6. Watch the requests execute in sequence with real-time status
7. View the created records' sys_ids and links to ServiceNow
8. Return later and see the history of what was created

For purchase orders, the same flow should work with supplier, PO, and PO line creation.

---

## Implementation Sequence

Build the application in this order:

1. **Settings and Connection** — Get ServiceNow authentication working first
2. **Manual Request Builder** — Allow users to construct and send arbitrary requests
3. **Document Upload and OCR** — Add file handling and text extraction
4. **AI Classification and Extraction** — Integrate OpenAI for document understanding
5. **Matching Engine** — Build the vendor/supplier lookup logic
6. **Automated Request Generation** — Generate requests from extracted data
7. **Batch Execution Engine** — Handle dependency ordering and sequential execution
8. **Session Management** — Add persistence and history
9. **Audit and Reporting** — Add logging and compliance features

Each phase should produce working functionality before moving to the next.
