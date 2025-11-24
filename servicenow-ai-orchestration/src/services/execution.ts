import type { ServiceNowAPI } from './servicenow';
import type { APIRequest, APIResponse, EntityType } from '../types';

interface ExecutionResult {
  requestId: string;
  success: boolean;
  response: APIResponse;
  sysId?: string;
}

interface ExecutionOptions {
  onRequestStart?: (requestId: string) => void;
  onRequestComplete?: (result: ExecutionResult) => void;
  onRequestFailed?: (requestId: string, error: APIResponse) => void;
  stopOnError?: boolean;
}

// Sort requests by entity execution order
export function sortRequestsByDependency(requests: APIRequest[]): APIRequest[] {
  const executionOrder: EntityType[] = [
    'vendor',
    'supplier',
    'cmdb_model',
    'service_offering',
    'asset',
    'contract',
    'purchase_order',
    'expense_line',
    'purchase_order_line',
    'contract_asset',
    'currency_instance',
    'supplier_product',
  ];

  return [...requests].sort((a, b) => {
    const aIndex = executionOrder.indexOf(a.entityType);
    const bIndex = executionOrder.indexOf(b.entityType);

    // Same entity type - preserve order
    if (aIndex === bIndex) {
      return 0;
    }

    // Unknown entity types go last
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;

    return aIndex - bIndex;
  });
}

// Extended result that includes entity type for dependency resolution
interface ExecutionResultWithEntity extends ExecutionResult {
  entityType: EntityType;
}

// Resolve dependencies - replace placeholder references with actual sys_ids
export function resolveDependencies(
  request: APIRequest,
  completedResultsByEntity: Map<EntityType, ExecutionResultWithEntity>
): APIRequest {
  const body = request.modifiedBody || request.body;
  const resolvedBody: Record<string, unknown> = { ...body };

  // Look for placeholder values that need to be resolved
  for (const [key, value] of Object.entries(resolvedBody)) {
    if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
      const placeholder = value.slice(2, -2); // Remove {{ and }}
      const [entityType, field] = placeholder.split('.');

      // Find the completed request that matches the entity type
      const matchingResult = completedResultsByEntity.get(entityType as EntityType);

      if (matchingResult && matchingResult.success && field === 'sys_id' && matchingResult.sysId) {
        resolvedBody[key] = matchingResult.sysId;
      }
    }
  }

  return {
    ...request,
    body: resolvedBody,
  };
}

// Execute a batch of requests in dependency order
export async function executeBatch(
  requests: APIRequest[],
  api: ServiceNowAPI,
  options: ExecutionOptions = {}
): Promise<ExecutionResult[]> {
  const sortedRequests = sortRequestsByDependency(
    requests.filter((r) => r.status === 'approved' || r.status === 'pending')
  );
  const results: ExecutionResult[] = [];
  // Map by entity type for dependency resolution (e.g., 'contract' -> result with sys_id)
  const completedResultsByEntity = new Map<EntityType, ExecutionResultWithEntity>();

  for (const request of sortedRequests) {
    options.onRequestStart?.(request.id);

    // Resolve any dependency placeholders using entity type mapping
    const resolvedRequest = resolveDependencies(request, completedResultsByEntity);

    try {
      const response = await api.executeRequest(
        resolvedRequest.method,
        resolvedRequest.url,
        resolvedRequest.headers,
        resolvedRequest.body as Record<string, unknown>
      );

      // Extract sys_id from successful response
      let sysId: string | undefined;
      if (response.status >= 200 && response.status < 300) {
        const data = response.data as { result?: { sys_id?: string } };
        sysId = data?.result?.sys_id;
      }

      const result: ExecutionResultWithEntity = {
        requestId: request.id,
        success: response.status >= 200 && response.status < 300,
        response,
        sysId,
        entityType: request.entityType,
      };

      results.push(result);

      // Store by entity type so dependent requests can find it
      // e.g., contract request result stored under 'contract' key
      if (result.success && result.sysId) {
        completedResultsByEntity.set(request.entityType, result);
      }

      if (result.success) {
        options.onRequestComplete?.(result);
      } else {
        options.onRequestFailed?.(request.id, response);

        if (options.stopOnError) {
          break;
        }
      }
    } catch (error) {
      const errorResponse: APIResponse = {
        status: 500,
        statusText: 'Internal Error',
        data: null,
        headers: {},
        error: error instanceof Error ? error.message : 'Unknown error',
      };

      const result: ExecutionResult = {
        requestId: request.id,
        success: false,
        response: errorResponse,
      };

      results.push(result);
      options.onRequestFailed?.(request.id, errorResponse);

      if (options.stopOnError) {
        break;
      }
    }
  }

  return results;
}

// Validate a request before execution
export function validateRequest(request: APIRequest): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!request.url) {
    errors.push('URL is required');
  }

  if (!request.method) {
    errors.push('HTTP method is required');
  }

  if (request.method === 'POST' || request.method === 'PATCH') {
    if (!request.body || Object.keys(request.body).length === 0) {
      errors.push('Request body is required for POST/PATCH requests');
    }
  }

  // Check for required fields based on entity type
  const body = request.modifiedBody || request.body;
  const requiredFields: Record<EntityType, string[]> = {
    vendor: ['name'],
    supplier: ['name'],
    contract: ['short_description'],
    expense_line: ['contract'],
    service_offering: ['name'],
    asset: ['name'],
    contract_asset: ['contract', 'asset'],
    cmdb_model: ['name'],
    purchase_order: ['supplier'],
    purchase_order_line: ['purchase_order'],
    currency_instance: ['amount', 'currency'],
    supplier_product: ['name'],
  };

  const required = requiredFields[request.entityType] || [];
  for (const field of required) {
    if (!body[field]) {
      errors.push(`Required field "${field}" is missing`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// Dry run - validate all requests without executing
export function dryRun(requests: APIRequest[]): {
  valid: boolean;
  results: Array<{ requestId: string; valid: boolean; errors: string[] }>;
} {
  const results = requests.map((request) => {
    const validation = validateRequest(request);
    return {
      requestId: request.id,
      valid: validation.valid,
      errors: validation.errors,
    };
  });

  return {
    valid: results.every((r) => r.valid),
    results,
  };
}
